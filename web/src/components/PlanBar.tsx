import { useState } from 'react';
import type { SavedPlan } from '../types';
import { fmt, formatTime } from '../lib/format';

interface PlanBarProps {
  plans: SavedPlan[];
  draftValid: boolean;
  onSave: (name: string) => void;
  onLoad: (plan: SavedPlan) => void;
  onDelete: (id: string) => void;
}

export function PlanBar({
  plans,
  draftValid,
  onSave,
  onLoad,
  onDelete,
}: PlanBarProps) {
  const [name, setName] = useState('');

  const handleSave = () => {
    const finalName = name.trim() || `方案 ${new Date().toLocaleString('zh-CN')}`;
    onSave(finalName);
    setName('');
  };

  return (
    <section className="card plan-card">
      <header className="card-header">
        <h2>方案保存 / 载入</h2>
        <span className="hint">保存在浏览器本地（localStorage），当前输入自动暂存</span>
      </header>
      <div className="plan-save-row">
        <input
          className="text-input"
          placeholder="为当前方案命名（可留空）"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSave();
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!draftValid}
        >
          保存当前方案
        </button>
      </div>

      {plans.length === 0 ? (
        <p className="hint">暂无已保存方案。</p>
      ) : (
        <ul className="saved-list">
          {plans.map((plan) => (
            <li key={plan.id} className="saved-row">
              <div className="saved-info">
                <strong>{plan.name}</strong>
                <span className="hint">
                  {plan.holeCount} 孔 · 阈值 {fmt(plan.threshold)} g ·{' '}
                  {plan.locked.filter(Boolean).length} 槽锁定 ·{' '}
                  {formatTime(plan.savedAt)}
                </span>
              </div>
              <div className="saved-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => onLoad(plan)}
                >
                  载入
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  onClick={() => onDelete(plan.id)}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
