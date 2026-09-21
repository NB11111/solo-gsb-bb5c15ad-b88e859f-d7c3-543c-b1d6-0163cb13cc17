import { useEffect, useState } from 'react';
import type { AnyPlan } from '../types';
import { planAdditionMap, planSlotSet } from '../lib/plan';
import { fmt, parseWeight } from '../lib/format';

interface WeightTableProps {
  holeCount: number;
  weights: number[];
  locked: boolean[];
  activePlan: AnyPlan | null;
  resetSignal: number;
  onSetWeight: (index: number, value: number) => void;
  onToggleLock: (index: number) => void;
  onClear: () => void;
}

const GRID_TEMPLATE: Record<number, string> = {
  8: 'repeat(4, minmax(0, 1fr))',
  12: 'repeat(6, minmax(0, 1fr))',
  24: 'repeat(8, minmax(0, 1fr))',
};

export function WeightTable({
  holeCount,
  weights,
  locked,
  activePlan,
  resetSignal,
  onSetWeight,
  onToggleLock,
  onClear,
}: WeightTableProps) {
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, boolean>>({});

  // 仅在切换转子规格 / 载入方案 / 应用推荐等外部重置时清空未提交草稿，
  // 避免输入小数（如 "12.5"）过程中被自己触发的 weights 更新打断
  useEffect(() => {
    setDraft({});
    setErrors({});
  }, [resetSignal]);

  const planSlots = planSlotSet(activePlan);
  const additionMap = planAdditionMap(activePlan);

  const commit = (index: number, raw: string) => {
    const value = parseWeight(raw);
    if (value === null) {
      setErrors((prev) => ({ ...prev, [index]: true }));
      return;
    }
    setErrors((prev) => ({ ...prev, [index]: false }));
    onSetWeight(index, value);
  };

  return (
    <section className="card">
      <header className="card-header">
        <h2>槽位重量录入</h2>
        <button type="button" className="btn btn-ghost" onClick={onClear}>
          全部清零
        </button>
      </header>
      <p className="hint">空槽按 0 处理，单位 g；点击🔒或在转盘上点槽位可锁定/解锁。</p>
      <div
        className="slot-grid"
        style={{ gridTemplateColumns: GRID_TEMPLATE[holeCount] }}
      >
        {Array.from({ length: holeCount }, (_, index) => {
          const raw = draft[index] ?? String(weights[index] === 0 ? '' : fmt(weights[index]));
          return (
            <div
              key={index}
              className={`slot-cell ${locked[index] ? 'is-locked' : ''} ${
                planSlots.has(index) ? 'is-plan' : ''
              }`}
            >
              <button
                type="button"
                className="lock-btn"
                aria-label={locked[index] ? `解锁 ${index + 1} 槽` : `锁定 ${index + 1} 槽`}
                aria-pressed={locked[index]}
                onClick={() => onToggleLock(index)}
              >
                {locked[index] ? '🔒' : '🔓'}
              </button>
              <label className="cell-label">
                {index + 1}
                {additionMap.has(index) && (
                  <em className="cell-add">+{fmt(additionMap.get(index))}</em>
                )}
              </label>
              <input
                inputMode="decimal"
                className={`weight-input ${errors[index] ? 'input-error' : ''}`}
                placeholder="0"
                disabled={locked[index]}
                value={raw}
                onChange={(event) => {
                  const text = event.target.value;
                  setDraft((prev) => ({ ...prev, [index]: text }));
                  const value = parseWeight(text);
                  if (value !== null) {
                    setErrors((prev) => ({ ...prev, [index]: false }));
                    onSetWeight(index, value);
                  } else {
                    setErrors((prev) => ({ ...prev, [index]: true }));
                  }
                }}
                onBlur={(event) => {
                  commit(index, event.target.value);
                  setDraft((prev) => {
                    const next = { ...prev };
                    delete next[index];
                    return next;
                  });
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
