import { useMemo, useState } from 'react';
import type {
  BalanceJob,
  BalanceStatus,
  HoleCount,
  RotorSnapshot,
  WizardStageId,
} from '../types';
import {
  STAGE_INDEX,
  WIZARD_STAGES,
  suggestJobNo,
  validateStage,
} from '../lib/wizard';
import { fmt, formatTimeSec } from '../lib/format';

interface WizardPanelProps {
  jobs: BalanceJob[];
  /** 当前在工作台中打开的作业（status = in_progress）；其余作业在下方列表 */
  activeJob: BalanceJob | null;
  weights: number[];
  liveMagnitude: number | null;
  liveStatus: BalanceStatus | null;
  /** 当前工作台阈值（g） */
  threshold: number;
  onCreateJob: (jobNo: string) => void;
  onSelectRotor: (holeCount: HoleCount) => void;
  onEditNote: (stage: WizardStageId, note: string) => void;
  onToggleReview: (confirmed: boolean) => void;
  onAdvance: () => void;
  onRollback: (target: WizardStageId) => void;
  onPause: () => void;
  onResume: (jobId: string) => void;
  onDelete: (jobId: string) => void;
}

const STATUS_TEXT: Record<BalanceStatus, string> = {
  balanced: '完全平衡',
  ok: '阈值内',
  over: '超阈值',
};

function JobStatusBadge({ status }: { status: BalanceJob['status'] }) {
  const className =
    status === 'completed'
      ? 'badge-balanced'
      : status === 'paused'
        ? 'badge-ok'
        : 'badge-wizard';
  const text =
    status === 'completed' ? '已完成' : status === 'paused' ? '已暂停' : '进行中';
  return <span className={`status-badge ${className}`}>{text}</span>;
}

/** 快照摘要一行；点击展开各槽重量 */
function SnapshotSummary({ snapshot }: { snapshot: RotorSnapshot }) {
  const nonZero = snapshot.weights.filter((w) => w > 0).length;
  return (
    <details className="snapshot-details">
      <summary>
        {formatTimeSec(snapshot.savedAt)} · {snapshot.holeCount} 孔 · 合力{' '}
        {snapshot.magnitude === null ? '—' : `${fmt(snapshot.magnitude)} g`}
        {snapshot.status && `（${STATUS_TEXT[snapshot.status]}）`} · 阈值{' '}
        {fmt(snapshot.threshold)} g · {nonZero} 槽非零
      </summary>
      <div className="snapshot-weights">
        {snapshot.weights.map((w, i) => (
          <span key={i} className={w > 0 ? '' : 'snapshot-zero'}>
            #{i + 1} {fmt(w)}
          </span>
        ))}
      </div>
    </details>
  );
}

/** 单个阶段的完成留痕（时间 / 备注 / 快照） */
function StageTrace({ job, stageId }: { job: BalanceJob; stageId: WizardStageId }) {
  const stage = job.stages[stageId];
  if (!stage.savedAt) return null;
  const meta = WIZARD_STAGES.find((s) => s.id === stageId);
  return (
    <div className="stage-trace">
      <div className="stage-trace-head">
        <span className="stage-trace-name">✓ {meta?.name}留痕</span>
        <span className="hint">{formatTimeSec(stage.savedAt)}</span>
      </div>
      {stage.note && <p className="stage-note">{stage.note}</p>}
      {stage.snapshot && <SnapshotSummary snapshot={stage.snapshot} />}
    </div>
  );
}

export function WizardPanel({
  jobs,
  activeJob,
  weights,
  liveMagnitude,
  liveStatus,
  threshold,
  onCreateJob,
  onSelectRotor,
  onEditNote,
  onToggleReview,
  onAdvance,
  onRollback,
  onPause,
  onResume,
  onDelete,
}: WizardPanelProps) {
  const [jobNoInput, setJobNoInput] = useState('');
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const currentIndex = activeJob ? STAGE_INDEX[activeJob.currentStage] : -1;

  const liveValidation = useMemo(() => {
    if (!activeJob) return null;
    return validateStage(activeJob.currentStage, {
      jobHoleCount: activeJob.holeCount,
      weights,
      magnitude: liveMagnitude,
      status: liveStatus,
      reviewConfirmed: activeJob.reviewConfirmed,
    });
  }, [activeJob, weights, liveMagnitude, liveStatus]);

  const handleCreate = () => {
    const jobNo = jobNoInput.trim() || suggestJobNo();
    onCreateJob(jobNo);
    setJobNoInput('');
    setAdvanceError(null);
  };

  const handleAdvance = () => {
    if (!activeJob) return;
    if (liveValidation) {
      setAdvanceError(liveValidation);
      return;
    }
    setAdvanceError(null);
    onAdvance();
  };

  const handleRollback = (target: WizardStageId) => {
    const meta = WIZARD_STAGES.find((s) => s.id === target);
    if (
      window.confirm(
        `确定回退到「${meta?.name}」阶段吗？该阶段及之后的完成记录将清空（备注保留），可重新推进。`,
      )
    ) {
      setAdvanceError(null);
      onRollback(target);
    }
  };

  const handleDelete = (job: BalanceJob) => {
    if (window.confirm(`确定删除作业「${job.jobNo}」吗？此操作不可恢复。`)) {
      onDelete(job.id);
      if (detailId === job.id) setDetailId(null);
    }
  };

  const stageMeta = activeJob
    ? WIZARD_STAGES.find((s) => s.id === activeJob.currentStage)
    : null;
  const nextMeta =
    activeJob && currentIndex < WIZARD_STAGES.length - 1
      ? WIZARD_STAGES[currentIndex + 1]
      : null;

  return (
    <section className="card wizard-card" id="wizard">
      <header className="card-header">
        <h2>配平作业向导</h2>
        <span className="hint">
          准备 → 称量 → 配平 → 复核，记录仅保存在浏览器本地
        </span>
      </header>

      {/* 新建作业 */}
      <div className="wizard-create-row">
        <input
          className="text-input"
          placeholder="作业编号（留空自动生成，如 WZ-20260922-…）"
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
      {activeJob && (
        <p className="hint">
          存在进行中的作业，创建新作业会先暂停当前作业「{activeJob.jobNo}」，之后可随时恢复。
        </p>
      )}

      {/* 进行中作业面板 */}
      {activeJob && stageMeta && (
        <div className="wizard-active">
          <div className="wizard-job-head">
            <div className="wizard-job-title">
              <strong>{activeJob.jobNo}</strong>
              <JobStatusBadge status={activeJob.status} />
            </div>
            <span className="hint">创建于 {formatTimeSec(activeJob.createdAt)}</span>
          </div>

          {/* 步骤条 */}
          <ol className="wizard-stepper">
            {WIZARD_STAGES.map((stage, index) => {
              const record = activeJob.stages[stage.id];
              const state =
                index < currentIndex || record.savedAt
                  ? 'done'
                  : index === currentIndex
                    ? 'current'
                    : 'todo';
              const rollbackable =
                index < currentIndex &&
                (activeJob.status === 'in_progress' ||
                  activeJob.status === 'completed');
              return (
                <li
                  key={stage.id}
                  className={`wizard-step wizard-step-${state}`}
                  aria-current={state === 'current' ? 'step' : undefined}
                >
                  <button
                    type="button"
                    className="wizard-step-btn"
                    disabled={!rollbackable}
                    title={rollbackable ? `回退到「${stage.name}」阶段` : stage.name}
                    onClick={() => handleRollback(stage.id)}
                  >
                    <span className="wizard-step-index">
                      {state === 'done' ? '✓' : index + 1}
                    </span>
                    <span className="wizard-step-name">{stage.name}</span>
                  </button>
                  {record.savedAt && (
                    <span className="wizard-step-time">
                      {formatTimeSec(record.savedAt)}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {/* 当前阶段操作区 */}
          <div className="wizard-stage-box">
            <h3 className="wizard-stage-title">
              当前阶段：{stageMeta.name}
              {nextMeta && <span className="hint">（下一阶段：{nextMeta.name}）</span>}
            </h3>
            <p className="hint wizard-requirement">{stageMeta.requirement}</p>

            {activeJob.currentStage === 'prepare' && (
              <label className="control wizard-rotor-select">
                转子规格
                <select
                  value={activeJob.holeCount ?? ''}
                  onChange={(event) =>
                    onSelectRotor(Number(event.target.value) as HoleCount)
                  }
                >
                  <option value="" disabled>
                    请选择转子规格
                  </option>
                  <option value={8}>8 孔</option>
                  <option value={12}>12 孔</option>
                  <option value={24}>24 孔</option>
                </select>
              </label>
            )}

            {activeJob.currentStage === 'weigh' && (
              <p className="hint">
                非零槽位：
                <strong
                  className={
                    weights.some((w) => w > 0)
                      ? 'wizard-ok-text'
                      : 'wizard-err-text'
                  }
                >
                  {' '}
                  {weights.filter((w) => w > 0).length} / {weights.length}
                </strong>
                ，请使用下方「槽位重量录入」表格录入称量结果。
              </p>
            )}

            {activeJob.currentStage === 'balance' && (
              <div className="wizard-live">
                <span>
                  当前合力：
                  <strong
                    className={
                      liveStatus === 'over'
                        ? 'wizard-err-text'
                        : 'wizard-ok-text'
                    }
                  >
                    {' '}
                    {liveMagnitude === null ? '计算中…' : `${fmt(liveMagnitude)} g`}
                  </strong>
                </span>
                {liveStatus && (
                  <span
                    className={`status-badge ${
                      liveStatus === 'over'
                        ? 'badge-over'
                        : liveStatus === 'ok'
                          ? 'badge-ok'
                          : 'badge-balanced'
                    }`}
                  >
                    {STATUS_TEXT[liveStatus]}
                  </span>
                )}
                <span className="hint">
                  合力 ≤ 阈值 {fmt(threshold)} g 才能推进（可借助右侧交换 / 补偿推荐）。
                </span>
              </div>
            )}

            {activeJob.currentStage === 'review' && (
              <div className="wizard-review">
                <div className="wizard-live">
                  <span>
                    最终合力：
                    <strong className="wizard-ok-text">
                      {' '}
                      {liveMagnitude === null ? '计算中…' : `${fmt(liveMagnitude)} g`}
                    </strong>
                  </span>
                  {liveStatus && (
                    <span
                      className={`status-badge ${
                        liveStatus === 'over'
                          ? 'badge-over'
                          : liveStatus === 'ok'
                            ? 'badge-ok'
                            : 'badge-balanced'
                      }`}
                    >
                      {STATUS_TEXT[liveStatus]}
                    </span>
                  )}
                </div>
                <label className="wizard-confirm">
                  <input
                    type="checkbox"
                    checked={activeJob.reviewConfirmed}
                    onChange={(event) => {
                      onToggleReview(event.target.checked);
                      if (event.target.checked) setAdvanceError(null);
                    }}
                  />
                  确认配平结果无误（最终合力、各槽重量已核对）
                </label>
              </div>
            )}

            {/* 阶段备注（自动保存） */}
            <label className="wizard-note-label">
              阶段备注（随阶段推进自动保存）
              <textarea
                className="wizard-note"
                rows={2}
                placeholder="如：天平编号、操作人、异常情况…"
                value={activeJob.stages[activeJob.currentStage].note}
                onChange={(event) => onEditNote(activeJob.currentStage, event.target.value)}
              />
            </label>

            {advanceError && (
              <p className="wizard-error" role="alert">
                ⚠ {advanceError}
              </p>
            )}

            <div className="wizard-actions">
              <button type="button" className="btn btn-primary" onClick={handleAdvance}>
                {activeJob.currentStage === 'review'
                  ? '确认复核，完成作业'
                  : `保存并进入「${WIZARD_STAGES[currentIndex + 1]?.name ?? ''}」`}
              </button>
              {currentIndex > 0 && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleRollback(WIZARD_STAGES[currentIndex - 1].id)}
                >
                  ↩ 回退到「{WIZARD_STAGES[currentIndex - 1].name}」
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setAdvanceError(null);
                  onPause();
                }}
              >
                暂停作业
              </button>
            </div>
            {liveValidation && !advanceError && (
              <p className="hint wizard-cond-hint">推进条件尚未满足：{liveValidation}</p>
            )}
          </div>

          {/* 已完成阶段留痕 */}
          <div className="wizard-traces">
            {WIZARD_STAGES.filter(
              (stage) => activeJob.stages[stage.id].savedAt !== null,
            ).map((stage) => (
              <StageTrace key={stage.id} job={activeJob} stageId={stage.id} />
            ))}
          </div>
        </div>
      )}

      {/* 作业列表 */}
      {jobs.length > 0 && (
        <div className="wizard-list">
          <h3 className="batch-subtitle">作业记录（{jobs.length}）</h3>
          <ul className="saved-list">
            {jobs.map((job) => {
              const expanded = detailId === job.id;
              const isActive = activeJob?.id === job.id;
              const stageMeta2 = WIZARD_STAGES.find(
                (s) => s.id === job.currentStage,
              );
              return (
                <li key={job.id} className="wizard-job-row">
                  <div className="saved-row">
                    <div className="saved-info">
                      <strong>{job.jobNo}</strong>
                      <span className="hint">
                        <JobStatusBadge status={job.status} />{' '}
                        {job.status === 'completed'
                          ? `结项于 ${formatTimeSec(job.completedAt ?? job.updatedAt)}`
                          : `${stageMeta2?.name}阶段 · 更新于 ${formatTimeSec(job.updatedAt)}`}
                        {job.holeCount && ` · ${job.holeCount} 孔`}
                      </span>
                    </div>
                    <div className="saved-actions">
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => setDetailId(expanded ? null : job.id)}
                      >
                        {expanded ? '收起' : '详情'}
                      </button>
                      {job.status === 'paused' && (
                        <button
                          type="button"
                          className="btn btn-small btn-primary"
                          onClick={() => {
                            setDetailId(null);
                            onResume(job.id);
                          }}
                        >
                          恢复
                        </button>
                      )}
                      {isActive && job.status === 'in_progress' && (
                        <span className="hint wizard-current-tag">当前作业</span>
                      )}
                      {(job.status === 'completed' || job.status === 'paused') && (
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={() => handleDelete(job)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div className="wizard-detail">
                      {job.pauseSnapshot && (
                        <>
                          <span className="hint">暂停时转子现场：</span>
                          <SnapshotSummary snapshot={job.pauseSnapshot} />
                        </>
                      )}
                      {WIZARD_STAGES.map((stage) => (
                        <StageTrace key={stage.id} job={job} stageId={stage.id} />
                      ))}
                      {WIZARD_STAGES.every(
                        (stage) => job.stages[stage.id].savedAt === null,
                      ) &&
                        !job.pauseSnapshot && (
                          <p className="hint">该作业尚无已保存的阶段记录。</p>
                        )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {jobs.length === 0 && (
        <p className="hint">
          暂无作业。录入作业编号并创建，即可按「准备 → 称量 → 配平 → 复核」推进。
        </p>
      )}
    </section>
  );
}
