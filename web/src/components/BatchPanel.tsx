import { useMemo, useState } from 'react';
import type { HoleCount, MeasurementRecord } from '../types';
import { summarizeBatches, type BatchStats } from '../lib/batchStats';
import { fmt, formatTimeSec } from '../lib/format';

interface BatchPanelProps {
  holeCount: HoleCount;
  threshold: number;
  records: MeasurementRecord[];
  onSaveSnapshot: (batchNo: string) => void;
  onDeleteRecord: (id: string) => void;
}

const DEFAULT_BATCH_NO = '默认批次';

/** 合力随时间变化趋势（按时间升序，虚线为当前阈值） */
function TrendChart({ batch, threshold }: { batch: BatchStats; threshold: number }) {
  const W = 640;
  const H = 150;
  const PAD_L = 40;
  const PAD_R = 14;
  const PAD_T = 12;
  const PAD_B = 24;
  const n = batch.records.length;
  const maxV = Math.max(threshold, ...batch.magnitudes, 0) * 1.15 || 1;
  const x = (i: number) =>
    n === 1
      ? PAD_L + (W - PAD_L - PAD_R) / 2
      : PAD_L + (i * (W - PAD_L - PAD_R)) / (n - 1);
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / maxV);
  const points = batch.magnitudes.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const first = batch.records[0];
  const last = batch.records[n - 1];

  return (
    <svg
      className="trend-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="合力趋势图"
    >
      {/* 坐标轴 */}
      <line className="trend-axis" x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} />
      <line
        className="trend-axis"
        x1={PAD_L}
        y1={H - PAD_B}
        x2={W - PAD_R}
        y2={H - PAD_B}
      />
      <text className="trend-label" x={4} y={y(maxV / 1.15) + 4}>
        {fmt(maxV / 1.15)}
      </text>
      <text className="trend-label" x={4} y={y(0) + 4}>
        0
      </text>
      {/* 阈值虚线 */}
      <line
        className="trend-threshold"
        x1={PAD_L}
        y1={y(threshold)}
        x2={W - PAD_R}
        y2={y(threshold)}
      />
      <text className="trend-label trend-label-threshold" x={W - PAD_R - 34} y={y(threshold) - 4}>
        阈值 {fmt(threshold)}
      </text>
      {/* 合力折线与数据点 */}
      {n > 1 && <polyline className="trend-line" points={points} />}
      {batch.records.map((record, i) => {
        const magnitude = batch.magnitudes[i];
        const over = magnitude > threshold;
        return (
          <circle
            key={record.id}
            className={`trend-point ${over ? 'trend-point-over' : ''}`}
            cx={x(i)}
            cy={y(magnitude)}
            r={4}
          >
            <title>
              {`${formatTimeSec(record.savedAt)} · 合力 ${fmt(magnitude)} g`}
            </title>
          </circle>
        );
      })}
      {/* 首末时间标签 */}
      <text className="trend-label" x={PAD_L} y={H - 8}>
        {formatTimeSec(first.savedAt)}
      </text>
      {n > 1 && (
        <text className="trend-label trend-label-end" x={W - PAD_R} y={H - 8}>
          {formatTimeSec(last.savedAt)}
        </text>
      )}
    </svg>
  );
}

export function BatchPanel({
  holeCount,
  threshold,
  records,
  onSaveSnapshot,
  onDeleteRecord,
}: BatchPanelProps) {
  const [batchNoInput, setBatchNoInput] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const batches = useMemo(
    () => summarizeBatches(records, threshold),
    [records, threshold],
  );
  const selected =
    batches.find((batch) => batch.key === selectedKey) ?? batches[0] ?? null;

  const handleSave = () => {
    const batchNo = batchNoInput.trim() || DEFAULT_BATCH_NO;
    onSaveSnapshot(batchNo);
    setSelectedKey(`${holeCount}::${batchNo}`);
  };

  return (
    <section className="card batch-card">
      <header className="card-header">
        <h2>测量批次统计</h2>
        <span className="hint">
          快照仅保存在浏览器本地，不影响当前配平状态
        </span>
      </header>

      <div className="batch-save-row">
        <input
          className="text-input"
          placeholder="批次编号（留空 = 默认批次）"
          value={batchNoInput}
          onChange={(event) => setBatchNoInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSave();
          }}
        />
        <button type="button" className="btn btn-primary" onClick={handleSave}>
          保存称量快照
        </button>
      </div>
      <p className="hint">
        判定规则（按当前阈值 {fmt(threshold)} g）：槽的标准差或最大偏差超阈值 →
        异常槽；批次内存在异常槽或任一单次合力超阈值 → 异常批次。
      </p>

      {batches.length === 0 ? (
        <p className="hint">暂无测量记录。录入批次编号后保存称量快照即可开始统计。</p>
      ) : (
        <>
          <div className="batch-select-row">
            <label className="control control-inline">
              查看批次
              <select
                value={selected?.key ?? ''}
                onChange={(event) => setSelectedKey(event.target.value)}
              >
                {batches.map((batch) => (
                  <option key={batch.key} value={batch.key}>
                    {batch.batchNo}（{batch.holeCount} 孔 · {batch.count} 次）
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <span
                className={`status-badge ${
                  selected.abnormal ? 'badge-over' : 'badge-balanced'
                }`}
              >
                {selected.abnormal ? '异常批次' : '正常批次'}
              </span>
            )}
          </div>

          {selected && (
            <>
              <dl className="status-grid batch-summary">
                <div>
                  <dt>记录次数</dt>
                  <dd>{selected.count}</dd>
                </div>
                <div>
                  <dt>合力均值</dt>
                  <dd>
                    {fmt(selected.meanMagnitude)} <small>g</small>
                  </dd>
                </div>
                <div>
                  <dt>合力最大 / 最小</dt>
                  <dd>
                    {fmt(selected.maxMagnitude)} / {fmt(selected.minMagnitude)}{' '}
                    <small>g</small>
                  </dd>
                </div>
                <div>
                  <dt>均值合力</dt>
                  <dd>
                    {fmt(selected.meanWeightsMagnitude)} <small>g</small>
                  </dd>
                </div>
                <div>
                  <dt>异常槽</dt>
                  <dd>
                    {selected.abnormalSlotCount} <small>/ {selected.holeCount}</small>
                  </dd>
                </div>
              </dl>

              <div className="batch-table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>槽号</th>
                      <th>均值 (g)</th>
                      <th>标准差 (g)</th>
                      <th>最大偏差 (g)</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.slots.map((slot) => (
                      <tr
                        key={slot.index}
                        className={slot.abnormal ? 'row-abnormal' : ''}
                      >
                        <td>#{slot.index + 1}</td>
                        <td>{fmt(slot.mean)}</td>
                        <td>{fmt(slot.stdDev)}</td>
                        <td>{fmt(slot.maxDev)}</td>
                        <td>
                          <span
                            className={`status-badge ${
                              slot.abnormal ? 'badge-over' : 'badge-balanced'
                            }`}
                          >
                            {slot.abnormal ? '异常' : '正常'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="batch-subtitle">合力趋势（按时间）</h3>
              <TrendChart batch={selected} threshold={threshold} />

              <h3 className="batch-subtitle">测量记录</h3>
              <ul className="saved-list">
                {[...selected.records].reverse().map((record, i) => {
                  const magnitude =
                    selected.magnitudes[selected.records.length - 1 - i];
                  const over = magnitude > threshold;
                  return (
                    <li key={record.id} className="saved-row">
                      <div className="saved-info">
                        <strong>{formatTimeSec(record.savedAt)}</strong>
                        <span className="hint">
                          合力 {fmt(magnitude)} g · 保存时阈值{' '}
                          {fmt(record.threshold)} g
                        </span>
                      </div>
                      <div className="saved-actions">
                        <span
                          className={`status-badge ${
                            over ? 'badge-over' : 'badge-balanced'
                          }`}
                        >
                          {over ? '超阈值' : '阈值内'}
                        </span>
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={() => onDeleteRecord(record.id)}
                        >
                          删除
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
