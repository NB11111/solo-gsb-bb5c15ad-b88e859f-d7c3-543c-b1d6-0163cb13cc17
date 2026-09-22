import type {
  BalanceJob,
  BalanceStatus,
  HoleCount,
  RotorSnapshot,
  WizardStageId,
  WizardStageRecord,
  WorkbenchDraft,
} from '../types';

/**
 * 配平作业向导：四阶段定义、推进校验与作业工厂。
 * 全部为纯函数（不触碰 localStorage / DOM），便于在 React 状态中组合。
 */

export const WIZARD_STAGES: {
  id: WizardStageId;
  name: string;
  short: string;
  /** 该阶段需要完成的动作（展示在阶段面板） */
  requirement: string;
}[] = [
  {
    id: 'prepare',
    name: '准备',
    short: '准备',
    requirement: '选择本次作业使用的转子规格（8 / 12 / 24 孔）。',
  },
  {
    id: 'weigh',
    name: '称量',
    short: '称量',
    requirement: '在下方重量录入区逐槽录入称量结果，至少一槽为非零重量。',
  },
  {
    id: 'balance',
    name: '配平',
    short: '配平',
    requirement: '通过交换 / 补偿把当前合力降到阈值以内（状态非“超阈值”）。',
  },
  {
    id: 'review',
    name: '复核',
    short: '复核',
    requirement: '核对最终合力与各槽重量，勾选“确认配平结果无误”。',
  },
];

export const STAGE_INDEX: Record<WizardStageId, number> = {
  prepare: 0,
  weigh: 1,
  balance: 2,
  review: 3,
};

/** 阈值比较容差，与后端 / 批次统计保持一致，消除浮点噪声 */
const EPS = 1e-9;

export function nextStageOf(stage: WizardStageId): WizardStageId | null {
  const index = STAGE_INDEX[stage];
  return index < WIZARD_STAGES.length - 1
    ? WIZARD_STAGES[index + 1].id
    : null;
}

function emptyStageRecord(): WizardStageRecord {
  return { savedAt: null, note: '', snapshot: null };
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 默认作业编号：WZ-YYYYMMDD-HHMMSS-随机后缀 */
export function suggestJobNo(now: number = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `WZ-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** 创建一份新作业（尚未选择转子，停在准备阶段） */
export function createJob(jobNo: string, now: number = Date.now()): BalanceJob {
  return {
    id: makeId(),
    jobNo: jobNo.trim(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    status: 'in_progress',
    currentStage: 'prepare',
    holeCount: null,
    reviewConfirmed: false,
    stages: {
      prepare: emptyStageRecord(),
      weigh: emptyStageRecord(),
      balance: emptyStageRecord(),
      review: emptyStageRecord(),
    },
    pauseSnapshot: null,
  };
}

/** 阶段推进校验所需的工作台现场 */
export interface StageValidationContext {
  /** 准备阶段：作业已选定的转子规格 */
  jobHoleCount: HoleCount | null;
  weights: number[];
  /** 后端实时计算的合力；结果未就绪（首次加载/请求失败）时为 null */
  magnitude: number | null;
  /** 后端实时状态：balanced / ok / over；未就绪时为 null */
  status: BalanceStatus | null;
  reviewConfirmed: boolean;
}

/**
 * 校验当前阶段是否允许推进。
 * 返回 null 表示通过；否则返回需要明确展示给用户的原因。
 */
export function validateStage(
  stage: WizardStageId,
  ctx: StageValidationContext,
): string | null {
  switch (stage) {
    case 'prepare':
      if (ctx.jobHoleCount === null) {
        return '准备未完成：请先在上方选择本次作业的转子规格（8 / 12 / 24 孔）。';
      }
      return null;
    case 'weigh': {
      const hasNonZero = ctx.weights.some(
        (w) => typeof w === 'number' && Number.isFinite(w) && w > EPS,
      );
      if (!hasNonZero) {
        return '称量未完成：请至少录入一个非零槽位的重量（当前全部槽位均为 0）。';
      }
      return null;
    }
    case 'balance': {
      if (ctx.status === null || ctx.magnitude === null) {
        return '配平结果尚未计算完成，请稍候再试（若持续失败请检查后端服务）。';
      }
      if (ctx.status === 'over') {
        return `配平未达标：当前合力 ${ctx.magnitude.toFixed(
          3,
        )} g 仍超过阈值，请继续交换或补偿后再推进。`;
      }
      return null;
    }
    case 'review':
      if (!ctx.reviewConfirmed) {
        return '复核未完成：请勾选“确认配平结果无误”后再结项。';
      }
      return null;
    default:
      return null;
  }
}

/** 取当前工作台现场生成转子快照 */
export function makeSnapshot(
  draft: WorkbenchDraft,
  result: { magnitude: number; status: BalanceStatus } | null,
  now: number = Date.now(),
): RotorSnapshot {
  return {
    holeCount: draft.holeCount,
    weights: [...draft.weights],
    locked: [...draft.locked],
    threshold: draft.threshold,
    mode: draft.mode,
    step: draft.step,
    maxPerSlot: draft.maxPerSlot,
    magnitude: result ? result.magnitude : null,
    status: result ? result.status : null,
    savedAt: now,
  };
}

/**
 * 推进到下一阶段：在当前阶段记录保存时间 / 备注 / 快照。
 * 调用方需先用 validateStage 校验通过。
 * 复核阶段推进即结项（status=completed）。
 */
export function advanceJob(
  job: BalanceJob,
  note: string,
  snapshot: RotorSnapshot,
  now: number = Date.now(),
): BalanceJob {
  const stage = job.currentStage;
  const next = nextStageOf(stage);
  const stages = {
    ...job.stages,
    [stage]: { savedAt: now, note: note.trim(), snapshot },
  };
  const isFinishing = next === null; // 复核阶段完成 = 作业结项
  return {
    ...job,
    stages,
    currentStage: isFinishing ? stage : (next as WizardStageId),
    status: isFinishing ? 'completed' : 'in_progress',
    completedAt: isFinishing ? now : null,
    pauseSnapshot: null,
    updatedAt: now,
  };
}

/**
 * 回退到指定阶段（必须早于当前阶段）：
 * 目标阶段及其之后所有阶段的完成记录与快照清空（备注保留，方便修订），
 * 复核确认重置；已结项作业被重新打开。
 */
export function rollbackJob(
  job: BalanceJob,
  target: WizardStageId,
  now: number = Date.now(),
): BalanceJob {
  const targetIndex = STAGE_INDEX[target];
  const stages = { ...job.stages };
  for (const { id } of WIZARD_STAGES) {
    if (STAGE_INDEX[id] >= targetIndex) {
      stages[id] = {
        savedAt: null,
        // 保留已填备注，回退后无需重新输入
        note: job.stages[id].note,
        snapshot: null,
      };
    }
  }
  return {
    ...job,
    stages,
    currentStage: target,
    status: 'in_progress',
    completedAt: null,
    reviewConfirmed: false,
    pauseSnapshot: null,
    updatedAt: now,
  };
}

/** 暂停：捕获当前转子现场，等待恢复 */
export function pauseJob(
  job: BalanceJob,
  snapshot: RotorSnapshot,
  now: number = Date.now(),
): BalanceJob {
  return {
    ...job,
    status: 'paused',
    pauseSnapshot: snapshot,
    updatedAt: now,
  };
}

/** 恢复暂停的作业 */
export function resumeJob(job: BalanceJob, now: number = Date.now()): BalanceJob {
  if (job.status !== 'paused') return job;
  return {
    ...job,
    status: 'in_progress',
    pauseSnapshot: null,
    updatedAt: now,
  };
}

/**
 * 恢复作业时应还原到工作台的快照：
 * 暂停现场优先；否则取最近一个已完成阶段的快照。
 */
export function resumeSnapshot(job: BalanceJob): RotorSnapshot | null {
  if (job.pauseSnapshot) return job.pauseSnapshot;
  for (let i = STAGE_INDEX[job.currentStage] - 1; i >= 0; i -= 1) {
    const snapshot = job.stages[WIZARD_STAGES[i].id].snapshot;
    if (snapshot) return snapshot;
  }
  return null;
}

/** 更新作业任意可变字段并刷新 updatedAt */
export function withJobUpdate<T extends keyof BalanceJob>(
  job: BalanceJob,
  patch: Pick<BalanceJob, T>,
  now: number = Date.now(),
): BalanceJob {
  return { ...job, ...patch, updatedAt: now };
}
