import type { BalanceResponse } from '../types';
import { fmt, fmtDeg } from '../lib/format';

interface StatusPanelProps {
  result: BalanceResponse | null;
  loading: boolean;
  error: string | null;
}

export function StatusPanel({ result, loading, error }: StatusPanelProps) {
  const resultant = result?.resultant;
  const status = result?.status ?? 'balanced';

  return (
    <section className={`card status-card status-${status}`}>
      <header className="card-header">
        <h2>实时失衡</h2>
        <span className={`status-badge badge-${status}`}>
          {status === 'over' ? '超阈值' : status === 'ok' ? '阈值内' : '完全平衡'}
        </span>
      </header>

      {error ? (
        <p className="error-text">计算失败：{error}</p>
      ) : (
        <dl className="status-grid">
          <div>
            <dt>合力大小</dt>
            <dd>
              {fmt(resultant?.magnitude)} <small>g</small>
            </dd>
          </div>
          <div>
            <dt>阈值</dt>
            <dd>
              {fmt(result?.threshold)} <small>g</small>
            </dd>
          </div>
          <div>
            <dt>方向（自顶顺时针）</dt>
            <dd>{fmtDeg(resultant?.directionDeg)}</dd>
          </div>
          <div>
            <dt>最接近槽位</dt>
            <dd>
              {resultant?.nearestSlotIndex !== null &&
              resultant?.nearestSlotIndex !== undefined
                ? `#${resultant.nearestSlotIndex + 1}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt>矢量分量 x / y</dt>
            <dd>
              {fmt(resultant?.x)} / {fmt(resultant?.y)}
            </dd>
          </div>
          <div className="loading-cell">
            <dt>计算</dt>
            <dd>{loading ? '计算中…' : '已更新'}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
