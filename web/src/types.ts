export type HoleCount = 8 | 12 | 24;

export type BalanceStatus = 'balanced' | 'ok' | 'over';

export type BalanceMode = 'swap' | 'compensate';

export interface SlotResult {
  index: number;
  weight: number;
  angleDeg: number;
  x: number;
  y: number;
}

export interface Resultant {
  x: number;
  y: number;
  magnitude: number;
  /** 自正上方顺时针的角度（度） */
  directionDeg: number | null;
  nearestSlotIndex: number | null;
}

export interface SwapPlan {
  kind: 'swap';
  /** 交换对（0 基槽号，按执行顺序） */
  swaps: [number, number][];
  projectedMagnitude: number;
  finalWeights: number[];
  improvement: number;
  /** 排序键：[交换次数, 槽号序列...] */
  tuple: number[];
}

export interface CompAddition {
  /** 0 基槽号 */
  slot: number;
  /** 该槽叠加的补偿质量（g，步长整数倍） */
  amount: number;
}

export interface CompensationPlan {
  kind: 'compensate';
  additions: CompAddition[];
  /** 总加质量 */
  totalAdded: number;
  /** 使用槽数（1 或 2） */
  usedSlots: number;
  projectedMagnitude: number;
  projectedX: number;
  projectedY: number;
  /** 补偿后合力方向（自正上方顺时针，度；完全抵消时为 null） */
  projectedDirectionDeg: number | null;
  finalWeights: number[];
  improvement: number;
  /** 排序键：[使用槽数, 槽号, 加量, ...] */
  tuple: number[];
}

export type AnyPlan = SwapPlan | CompensationPlan;

export interface BalanceResponse {
  holeCount: HoleCount;
  threshold: number;
  mode: BalanceMode;
  status: BalanceStatus;
  slots: SlotResult[];
  resultant: Resultant;
  // 交换模式
  enumeration?: number;
  recommendation?: SwapPlan | null;
  alternatives?: SwapPlan[];
  // 定量补偿模式
  compStep?: number;
  compMaxPerSlot?: number;
  compEnumeration?: number;
  /** 离散档下可达的最小合力 */
  minimumMagnitude?: number;
  /** 最小可达合力是否在阈值内 */
  thresholdReachable?: boolean;
  compRecommendation?: CompensationPlan | null;
  compAlternatives?: CompensationPlan[];
}

export interface BalanceRequest {
  holeCount: HoleCount;
  weights: number[];
  locked: boolean[];
  threshold: number;
  mode: BalanceMode;
  // 定量补偿参数
  step?: number;
  maxPerSlot?: number;
}

export interface SavedPlan {
  id: string;
  name: string;
  savedAt: number;
  holeCount: HoleCount;
  weights: number[];
  locked: boolean[];
  threshold: number;
  /** 旧版本保存的方案无此字段，载入时按 swap 处理 */
  mode?: BalanceMode;
  step?: number;
  maxPerSlot?: number;
}

/** 一次称量快照（测量批次记录，仅存浏览器本地） */
export interface MeasurementRecord {
  id: string;
  /** 批次编号；同一批次编号 + 转子规格的记录归为一组统计 */
  batchNo: string;
  holeCount: HoleCount;
  weights: number[];
  /** 保存时的工作台阈值（g），仅作记录参考 */
  threshold: number;
  savedAt: number;
}

/** 当前编辑中的工作台状态 */
export interface WorkbenchDraft {
  holeCount: HoleCount;
  weights: number[];
  locked: boolean[];
  threshold: number;
  mode: BalanceMode;
  step: number;
  maxPerSlot: number;
}

/* ---------- 配平作业向导 ---------- */

export type WizardStageId = 'prepare' | 'weigh' | 'balance' | 'review';

export type WizardJobStatus = 'in_progress' | 'paused' | 'completed';

/** 阶段保存瞬间的转子完整快照（仅存浏览器本地，用于作业留痕与回退/恢复） */
export interface RotorSnapshot {
  holeCount: HoleCount;
  weights: number[];
  locked: boolean[];
  threshold: number;
  mode: BalanceMode;
  step: number;
  maxPerSlot: number;
  /** 快照瞬间后端计算的合力（g）；结果尚未就绪时为 null */
  magnitude: number | null;
  status: BalanceStatus | null;
  savedAt: number;
}

/** 单个阶段的留痕：完成时间、备注、当时转子快照（未完成时后两者之外的时间/快照为 null） */
export interface WizardStageRecord {
  savedAt: number | null;
  note: string;
  snapshot: RotorSnapshot | null;
}

/** 一次配平作业：准备 → 称量 → 配平 → 复核 */
export interface BalanceJob {
  id: string;
  /** 用户创建的作业编号 */
  jobNo: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  status: WizardJobStatus;
  /** 当前所处阶段；已结项作业停留在 review */
  currentStage: WizardStageId;
  /** 准备阶段选择的转子规格（未选择时为 null，准备阶段校验项） */
  holeCount: HoleCount | null;
  /** 复核确认勾选（复核阶段校验项） */
  reviewConfirmed: boolean;
  stages: Record<WizardStageId, WizardStageRecord>;
  /** 暂停时捕获的转子现场，恢复时还原到工作台；推进阶段后清空 */
  pauseSnapshot: RotorSnapshot | null;
}
