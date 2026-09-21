import type { HoleCount, MeasurementRecord } from '../types';

/**
 * 测量批次统计：全部基于浏览器本地保存的称量快照，
 * 与后端配平计算无关，保存/删除均不改变当前工作台状态。
 */

const TAU = Math.PI * 2;
/** 阈值比较容差，消除浮点噪声（与后端 1e-6 舍入思路一致） */
const EPS = 1e-9;

/** 槽位数学 to 数学角（弧度，0 号槽在正上方，顺时针）——与后端 balancing.js 一致 */
export function slotAngleRad(index: number, holeCount: number): number {
  return TAU / 4 - (index * TAU) / holeCount;
}

/** 一组重量矢量的失衡合力大小（g） */
export function resultantMagnitude(
  weights: number[],
  holeCount: number,
): number {
  let x = 0;
  let y = 0;
  for (let i = 0; i < holeCount; i += 1) {
    const angle = slotAngleRad(i, holeCount);
    x += (weights[i] ?? 0) * Math.cos(angle);
    y += (weights[i] ?? 0) * Math.sin(angle);
  }
  return Math.hypot(x, y);
}

export interface SlotStats {
  index: number;
  /** 该槽各次称量均值（g） */
  mean: number;
  /** 样本标准差（n-1；仅 1 条记录时为 0） */
  stdDev: number;
  /** 各次记录相对均值的最大绝对偏差（g） */
  maxDev: number;
  /** 标准差或最大偏差超过阈值 */
  abnormal: boolean;
}

export interface BatchStats {
  key: string;
  batchNo: string;
  holeCount: HoleCount;
  /** 该批次记录，按时间升序 */
  records: MeasurementRecord[];
  count: number;
  slots: SlotStats[];
  /** 各次记录的合力大小（与 records 同序） */
  magnitudes: number[];
  meanMagnitude: number;
  maxMagnitude: number;
  minMagnitude: number;
  /** 各槽均值重量合成的合力（g） */
  meanWeightsMagnitude: number;
  abnormalSlotCount: number;
  /** 存在异常槽，或任一单次合力超阈值 */
  abnormal: boolean;
}

/** 批次分组键：批次编号 + 转子规格（不同规格槽位不对齐，不混合统计） */
export function batchKeyOf(record: MeasurementRecord): string {
  return `${record.holeCount}::${record.batchNo}`;
}

export function computeBatchStats(
  batchNo: string,
  holeCount: HoleCount,
  records: MeasurementRecord[],
  threshold: number,
): BatchStats {
  const sorted = [...records].sort((a, b) => a.savedAt - b.savedAt);
  const count = sorted.length;

  const slots: SlotStats[] = Array.from({ length: holeCount }, (_, index) => {
    const values = sorted.map((record) => record.weights[index] ?? 0);
    const mean = values.reduce((sum, v) => sum + v, 0) / count;
    const variance =
      count > 1
        ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (count - 1)
        : 0;
    const stdDev = Math.sqrt(variance);
    const maxDev = values.reduce((max, v) => Math.max(max, Math.abs(v - mean)), 0);
    return {
      index,
      mean,
      stdDev,
      maxDev,
      abnormal: stdDev > threshold + EPS || maxDev > threshold + EPS,
    };
  });

  const magnitudes = sorted.map((record) =>
    resultantMagnitude(record.weights, holeCount),
  );
  const meanMagnitude =
    magnitudes.reduce((sum, v) => sum + v, 0) / Math.max(count, 1);
  const maxMagnitude = magnitudes.reduce((max, v) => Math.max(max, v), 0);
  const minMagnitude = magnitudes.reduce(
    (min, v) => Math.min(min, v),
    magnitudes[0] ?? 0,
  );
  const meanWeightsMagnitude = resultantMagnitude(
    slots.map((slot) => slot.mean),
    holeCount,
  );

  const abnormalSlotCount = slots.filter((slot) => slot.abnormal).length;

  return {
    key: `${holeCount}::${batchNo}`,
    batchNo,
    holeCount,
    records: sorted,
    count,
    slots,
    magnitudes,
    meanMagnitude,
    maxMagnitude,
    minMagnitude,
    meanWeightsMagnitude,
    abnormalSlotCount,
    abnormal: abnormalSlotCount > 0 || maxMagnitude > threshold + EPS,
  };
}

/** 汇总全部批次，按最近一次记录时间倒序排列 */
export function summarizeBatches(
  records: MeasurementRecord[],
  threshold: number,
): BatchStats[] {
  const groups = new Map<
    string,
    { batchNo: string; holeCount: HoleCount; records: MeasurementRecord[] }
  >();
  for (const record of records) {
    const key = batchKeyOf(record);
    let group = groups.get(key);
    if (!group) {
      group = { batchNo: record.batchNo, holeCount: record.holeCount, records: [] };
      groups.set(key, group);
    }
    group.records.push(record);
  }
  return [...groups.values()]
    .map((group) =>
      computeBatchStats(group.batchNo, group.holeCount, group.records, threshold),
    )
    .sort((a, b) => {
      const lastA = a.records[a.records.length - 1]?.savedAt ?? 0;
      const lastB = b.records[b.records.length - 1]?.savedAt ?? 0;
      return lastB - lastA;
    });
}
