import type {
  AnyPlan,
  BalanceMode,
  BalanceResponse,
  CompensationPlan,
  SwapPlan,
} from '../types';
import { fmt } from '../lib/format';

interface RecommendPanelProps {
  result: BalanceResponse | null;
  mode: BalanceMode;
  step: number;
  maxPerSlot: number;
  activePlan: AnyPlan | null;
  onSwitchMode: (mode: BalanceMode) => void;
  onChangeCompParam: (patch: { step?: number; maxPerSlot?: number }) => void;
  onApply: () => void;
  onPreview: (plan: AnyPlan | null) => void;
}

function describeSwaps(plan: SwapPlan): string {
  return plan.swaps
    .map(([a, b], stepIdx) => `第${stepIdx + 1}次：槽 ${a + 1} ⇄ 槽 ${b + 1}`)
    .join('，');
}

function describeAdditions(plan: CompensationPlan): string {
  return plan.additions
    .map(({ slot, amount }) => `槽 ${slot + 1} 加 ${fmt(amount)} g`)
    .join('，');
}

function PlanRow({
  plan,
  current,
  emphasized,
  onPreview,
}: {
  plan: AnyPlan;
  current: number;
  emphasized?: boolean;
  onPreview: (plan: AnyPlan | null) => void;
}) {
  return (
    <li
      className={`plan-row ${emphasized ? 'plan-row-best' : ''}`}
      onMouseEnter={() => onPreview(plan)}
      onMouseLeave={() => onPreview(null)}
      onFocus={() => onPreview(plan)}
      onBlur={() => onPreview(null)}
    >
      <div className="plan-row-main">
        <span className="plan-swaps">
          {plan.kind === 'swap'
            ? describeSwaps(plan)
            : describeAdditions(plan)}
        </span>
        <span className="plan-metrics">
          合力 {fmt(current)} → <strong>{fmt(plan.projectedMagnitude)}</strong> g
          <em>（降低 {fmt(plan.improvement)} g）</em>
          {plan.kind === 'compensate' && (
            <em className="plan-comp-meta">
              · 共加 {fmt(plan.totalAdded)} g · {plan.usedSlots} 槽
            </em>
          )}
        </span>
      </div>
    </li>
  );
}

function ModeSwitch({
  mode,
  onSwitchMode,
}: {
  mode: BalanceMode;
  onSwitchMode: (mode: BalanceMode) => void;
}) {
  return (
    <div className="mode-switch" role="tablist" aria-label="配平模式">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'swap'}
        className={`mode-tab ${mode === 'swap' ? 'mode-tab-active' : ''}`}
        onClick={() => onSwitchMode('swap')}
      >
        交换配平
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'compensate'}
        className={`mode-tab ${mode === 'compensate' ? 'mode-tab-active' : ''}`}
        onClick={() => onSwitchMode('compensate')}
      >
        定量补偿
      </button>
    </div>
  );
}

function CompParams({
  step,
  maxPerSlot,
  onChange,
}: {
  step: number;
  maxPerSlot: number;
  onChange: (patch: { step?: number; maxPerSlot?: number }) => void;
}) {
  return (
    <div className="comp-params">
      <label className="control">
        补偿步长 (g)
        <input
          type="number"
          min={0}
          step={0.1}
          className="threshold-input"
          value={Number.isFinite(step) ? step : ''}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value > 0) onChange({ step: value });
          }}
        />
      </label>
      <label className="control">
        每槽最大可加 (g)
        <input
          type="number"
          min={0}
          step={0.5}
          className="threshold-input"
          value={Number.isFinite(maxPerSlot) ? maxPerSlot : ''}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value > 0) onChange({ maxPerSlot: value });
          }}
        />
      </label>
    </div>
  );
}

export function RecommendPanel({
  result,
  mode,
  step,
  maxPerSlot,
  activePlan,
  onSwitchMode,
  onChangeCompParam,
  onApply,
  onPreview,
}: RecommendPanelProps) {
  const status = result?.status;
  const current = result?.resultant.magnitude ?? 0;

  const best: AnyPlan | null =
    mode === 'compensate'
      ? (result?.compRecommendation ?? null)
      : (result?.recommendation ?? null);
  const alternatives: AnyPlan[] =
    mode === 'compensate'
      ? (result?.compAlternatives ?? [])
      : (result?.alternatives ?? []);
  const others = best ? alternatives.slice(1) : alternatives;

  const enumerationText =
    mode === 'compensate'
      ? result?.compEnumeration !== undefined
        ? `已评估 ${result.compEnumeration} 个离散组合（≤2 槽加重）`
        : null
      : result?.enumeration !== undefined
        ? `已枚举 ${result.enumeration} 种方案（≤2 次交换）`
        : null;

  const paramsInvalid =
    mode === 'compensate' &&
    (!(step > 0) ||
      !(maxPerSlot > 0) ||
      maxPerSlot + 1e-9 < step ||
      Math.abs(Math.round(maxPerSlot / step) * step - maxPerSlot) > 1e-6);

  return (
    <section className="card recommend-card">
      <header className="card-header recommend-header">
        <h2>配平推荐</h2>
        <ModeSwitch mode={mode} onSwitchMode={onSwitchMode} />
      </header>

      {mode === 'compensate' && (
        <CompParams
          step={step}
          maxPerSlot={maxPerSlot}
          onChange={onChangeCompParam}
        />
      )}

      {enumerationText && <span className="hint enumeration-hint">{enumerationText}</span>}

      {mode === 'compensate' && paramsInvalid ? (
        <p className="error-text">
          参数无效：步长需为正数，每槽最大可加质量需为步长的整数倍且不小于步长。
        </p>
      ) : status !== 'over' ? (
        <p className="hint">
          {status === 'balanced'
            ? '当前完全平衡，无需处理。'
            : '失衡合力处于阈值内，无需处理。'}
        </p>
      ) : mode === 'compensate' ? (
        <CompBody
          result={result}
          best={best as CompensationPlan | null}
          others={others as CompensationPlan[]}
          current={current}
          activePlan={activePlan}
          onApply={onApply}
          onPreview={onPreview}
        />
      ) : !best ? (
        <p className="hint">
          未锁定槽位不足或没有可减小失衡的交换方案，可尝试解锁更多槽位。
        </p>
      ) : (
        <>
          <ul className="plan-list">
            <PlanRow
              plan={best}
              current={current}
              emphasized
              onPreview={onPreview}
            />
            {others.map((plan, i) => (
              <PlanRow key={i} plan={plan} current={current} onPreview={onPreview} />
            ))}
          </ul>
          <div className="recommend-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onApply}
              disabled={!activePlan}
            >
              一键应用推荐并重算
            </button>
            <span className="hint">
              悬停候选可在转盘上预览涉及槽位；同合力方案按交换次数、槽号升序。
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function CompBody({
  result,
  best,
  others,
  current,
  activePlan,
  onApply,
  onPreview,
}: {
  result: BalanceResponse | null;
  best: CompensationPlan | null;
  others: CompensationPlan[];
  current: number;
  activePlan: AnyPlan | null;
  onApply: () => void;
  onPreview: (plan: AnyPlan | null) => void;
}) {
  const minimum = result?.minimumMagnitude;
  const reachable = result?.thresholdReachable;
  const hasUnlocked = (result?.compEnumeration ?? 1) > 1 || best !== null;

  if (!hasUnlocked && minimum !== undefined) {
    return (
      <p className="hint">
        所有槽位均已锁定，无法在任何槽位加重；当前合力 {fmt(current)} g 保持不变。
      </p>
    );
  }

  return (
    <>
      {reachable === false && minimum !== undefined && (
        <p className="comp-warning">
          ⚠ 现有步长与每槽上限下无法达到阈值 {fmt(result?.threshold)} g，
          最小可达合力为 <strong>{fmt(minimum)}</strong> g（下列方案按合力最小优先）。
        </p>
      )}
      {!best ? (
        <p className="hint">在当前参数下，任何加重都无法减小失衡合力。</p>
      ) : (
        <>
          <ul className="plan-list">
            <PlanRow
              plan={best}
              current={current}
              emphasized
              onPreview={onPreview}
            />
            {others.map((plan, i) => (
              <PlanRow
                key={i}
                plan={plan}
                current={current}
                onPreview={onPreview}
              />
            ))}
          </ul>
          <div className="recommend-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onApply}
              disabled={!activePlan}
            >
              一键叠加补偿并重算
            </button>
            <span className="hint">
              悬停候选预览补偿矢量；排序：合力 → 总加质量 → 槽数 → 槽号、加量。
            </span>
          </div>
        </>
      )}
    </>
  );
}
