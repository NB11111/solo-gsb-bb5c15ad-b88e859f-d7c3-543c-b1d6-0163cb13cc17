import { useEffect, useState } from 'react';
import type { BalanceJob, HoleCount, RotorSnapshot } from '../types';
import {
  STAGES,
  STAGE_DESCRIPTIONS,
  STAGE_LABELS,
  checksForStage,
  currentStageOf,
  isJobCompleted,
} from '../lib/jobFlow';
import { fmt, formatTimeSec } from '../lib/format';

interface JobWizardProps {
  jobs: BalanceJob[];
  activeJob: BalanceJob | null;
  /** 工作台当前状态（用于实时条件校验与阶段快照） */
  holeCount: HoleCount;
  weights: number[];
  threshold: number;
  /** 当前合力（g）；尚未算出为 null */
  magnitude: number | null;
  onSelectJob: (id: string | null) => void;
  /** 返回 null 表示创建成功，否则为错误提示 */
  onCreateJob: (jobNo: string) => string | null;
  onSelectRotor: (jobId: string, holeCount: HoleCount) => void;
  /** 返回 null 表示推进成功，否则为未满足条件的明确提示 */
  onAdvance: (
    jobId: string,
    note: string,
    reviewConfirmed: boolean,
  ) => string | null;
  onBack: (jobId: string) => void;
  onTogglePause: (jobId: string) => void;
  onDelete: (jobId: string) => void;
}

const HOLE_OPTIONS: HoleCount[] = [8, 12, 24];

function jobStatusText(job: BalanceJob): string {
  if (isJobCompleted(job)) return '已完成';
  const stageLabel = STAGE_LABELS[currentStageOf(job)];
  return job.paused ? `已暂停 · ${stageLabel}` : `进行中 · ${stageLabel}`;
}

function jobBadgeClass(job: BalanceJob): string {
  if (isJobCompleted(job)) return 'badge-balanced';
  return job.paused ? 'badge-ok' : 'badge-info';
}

function snapshotSummary(snapshot: RotorSnapshot): string {
  const nonZero = snapshot.weights.filter((weight) => weight > 0).length;
  const total = snapshot.weights.reduce((sum, weight) => sum + weight, 0);
  return `${snapshot.holeCount} 孔 · 非零 ${nonZero} 槽 · 总重 ${fmt(
    total,
  )} g · 合力 ${fmt(snapshot.magnitude)} g · 阈值 ${fmt(snapshot.threshold)} g`;
}

export function JobWizard({
  jobs,
  activeJob,
  holeCount,
  weights,
  threshold,
  magnitude,
  onSelectJob,
  onCreateJob,
  onSelectRotor,
  onAdvance,
  onBack,
  onTogglePause,
  onDelete,
}: JobWizardProps) {
  const [jobNoInput, setJobNoInput] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const completed = activeJob !== null && isJobCompleted(activeJob);
  const stage = activeJob && !completed ? currentStageOf(activeJob) : null;
  const stageKey = activeJob ? `${activeJob.id}:${activeJob.records.length}` : '';

  // 切换作业或阶段时，清空上一阶段未提交的备注 / 确认 / 错误
  useEffect(() => {
    setNote('');
    setReviewConfirmed(false);
    setAdvanceError(null);
  }, [stageKey]);

  const checks =
    activeJob && stage
      ? checksForStage(stage, {
          jobHoleCount: activeJob.holeCount,
          weights,
          threshold,
          magnitude,
          reviewConfirmed,
        })
      : [];

  const handleCreate = () => {
    const error = onCreateJob(jobNoInput);
    setCreateError(error);
    if (!error) setJobNoInput('');
  };

  const handleAdvance = () => {
    if (!activeJob) return;
    const error = onAdvance(activeJob.id, note, reviewConfirmed);
    setAdvanceError(error);
  };

  const rotorMismatch =
    activeJob !== null &&
    activeJob.holeCount !== null &&
    activeJob.holeCount !== holeCount;

  return (
    <section className="card wizard-card">
      <header className="card-header">
        <h2>配平作业向导</h2>
        <span className="hint">
          准备 → 称量 → 配平 → 复核，记录仅保存在浏览器本地
        </span>
      </header>

      <div className="wizard-create-row">
        <input
          className="text-input"
          placeholder="作业编号（如 JOB-20260922-01）"
          value={jobNoInput}
          onChange={(event) => setJobNoInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleCreate();
          }}
        />
        <button type="button" className="btn btn-primary" onClick={handleCreate}>
          创建作业
        </button>
      </div>
      {createError && <p className="error-text">{createError}</p>}

      {jobs.length === 0 ? (
        <p className="hint">
          暂无作业。录入作业编号并创建后，按「准备 → 称量 → 配平 → 复核」四阶段推进，
          每阶段自动保存时间、备注与当时转子快照。
        </p>
      ) : (
        <div className="wizard-select-row">
          <label className="control control-inline">
            当前作业
            <select
              value={activeJob?.id ?? ''}
              onChange={(event) => onSelectJob(event.target.value || null)}
            >
              <option value="">选择作业…</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.jobNo}（{jobStatusText(job)}）
                </option>
              ))}
            </select>
          </label>
          {activeJob && (
            <span className={`status-badge ${jobBadgeClass(activeJob)}`}>
              {jobStatusText(activeJob)}
            </span>
          )}
        </div>
      )}

      {activeJob && (
        <>
          <ol className="wizard-steps">
            {STAGES.map((stageItem, index) => {
              const done = activeJob.records.length > index;
              const current = !completed && activeJob.records.length === index;
              return (
                <li
                  key={stageItem}
                  className={`wizard-step ${done ? 'is-done' : ''} ${
                    current ? 'is-current' : ''
                  }`}
                >
                  <span className="wizard-step-dot">{done ? '✓' : index + 1}</span>
                  <span className="wizard-step-label">
                    {STAGE_LABELS[stageItem]}
                  </span>
                </li>
              );
            })}
          </ol>

          {rotorMismatch && (
            <p className="wizard-mismatch">
              注意：工作台当前为 {holeCount} 孔转子，与作业选定的{' '}
              {activeJob.holeCount} 孔不一致，阶段快照将以工作台实际状态为准。
            </p>
          )}

          {completed ? (
            <div className="wizard-completed">
              <span>
                <span className="status-badge badge-balanced">已完成</span>{' '}
                作业「{activeJob.jobNo}」已于{' '}
                {activeJob.completedAt
                  ? formatTimeSec(activeJob.completedAt)
                  : '—'}{' '}
                完成复核并归档。
              </span>
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => onDelete(activeJob.id)}
              >
                删除该作业
              </button>
            </div>
          ) : (
            stage && (
              <div className="wizard-stage-panel">
                <h3>
                  当前阶段：{STAGE_LABELS[stage]}
                  {activeJob.paused && (
                    <span className="status-badge badge-ok wizard-paused-badge">
                      已暂停
                    </span>
                  )}
                </h3>
                <p className="hint">{STAGE_DESCRIPTIONS[stage]}</p>

                {stage === 'prepare' && (
                  <label className="control control-inline wizard-rotor-select">
                    转子规格
                    <select
                      value={activeJob.holeCount ?? ''}
                      disabled={activeJob.paused}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (HOLE_OPTIONS.includes(value as HoleCount)) {
                          onSelectRotor(activeJob.id, value as HoleCount);
                        }
                      }}
                    >
                      <option value="" disabled>
                        请选择转子
                      </option>
                      {HOLE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n} 孔
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {stage === 'review' && (
                  <label className="wizard-confirm">
                    <input
                      type="checkbox"
                      checked={reviewConfirmed}
                      disabled={activeJob.paused}
                      onChange={(event) =>
                        setReviewConfirmed(event.target.checked)
                      }
                    />
                    <span>
                      确认配平结果：当前合力 {fmt(magnitude)} g，阈值{' '}
                      {fmt(threshold)} g
                      {magnitude !== null &&
                        (magnitude <= threshold ? '（阈值内）' : '（超阈值）')}
                    </span>
                  </label>
                )}

                <ul className="wizard-checks">
                  {checks.map((check) => (
                    <li
                      key={check.label}
                      className={check.pass ? 'check-pass' : 'check-fail'}
                    >
                      {check.pass ? '✓' : '✗'} {check.label}
                    </li>
                  ))}
                </ul>

                <textarea
                  className="wizard-note"
                  rows={2}
                  placeholder="阶段备注（可选，随阶段记录保存）"
                  value={note}
                  disabled={activeJob.paused}
                  onChange={(event) => setNote(event.target.value)}
                />

                {advanceError && <p className="error-text">{advanceError}</p>}
                {activeJob.paused && (
                  <p className="hint">
                    作业已暂停：恢复后才能推进或回退；刷新页面后暂停状态保留。
                  </p>
                )}

                <div className="wizard-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={
                      activeJob.paused || activeJob.records.length === 0
                    }
                    onClick={() => onBack(activeJob.id)}
                  >
                    ← 回退上一阶段
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onTogglePause(activeJob.id)}
                  >
                    {activeJob.paused ? '▶ 恢复作业' : '⏸ 暂停作业'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={activeJob.paused}
                    onClick={handleAdvance}
                  >
                    {stage === 'review'
                      ? '完成复核并归档作业'
                      : `完成「${STAGE_LABELS[stage]}」并推进`}
                  </button>
                </div>
              </div>
            )
          )}

          {activeJob.records.length > 0 && (
            <>
              <h3 className="wizard-subtitle">阶段记录</h3>
              <ul className="wizard-records">
                {activeJob.records.map((record, index) => (
                  <li
                    key={`${record.stage}-${record.completedAt}`}
                    className="wizard-record"
                  >
                    <div className="wizard-record-head">
                      <strong>
                        {index + 1}. {STAGE_LABELS[record.stage]}
                      </strong>
                      <span className="hint">
                        {formatTimeSec(record.completedAt)}
                      </span>
                    </div>
                    {record.note && (
                      <p className="wizard-record-note">备注：{record.note}</p>
                    )}
                    <p className="hint">快照：{snapshotSummary(record.snapshot)}</p>
                    <details className="wizard-snapshot-detail">
                      <summary>槽位重量明细</summary>
                      <div className="wizard-snapshot-weights">
                        {record.snapshot.weights.map((weight, slotIndex) => (
                          <span key={slotIndex}>
                            #{slotIndex + 1} {fmt(weight)} g
                            {record.snapshot.locked[slotIndex] ? ' 🔒' : ''}
                          </span>
                        ))}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
