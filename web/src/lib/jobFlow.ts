import type { BalanceJob, HoleCount, JobStage } from '../types';
import { fmt } from './format';

/**
 * 配平作业向导的阶段流转与推进条件。
 * 全部基于浏览器本地数据计算，不经过服务器。
 */

/** 四个阶段（按推进顺序） */
export const STAGES: JobStage[] = ['prepare', 'weigh', 'balance', 'review'];

export const STAGE_LABELS: Record<JobStage, string> = {
  prepare: '准备',
  weigh: '称量',
  balance: '配平',
  review: '复核',
};

export const STAGE_DESCRIPTIONS: Record<JobStage, string> = {
  prepare: '选择本次作业使用的转子规格，工作台会同步切换。',
  weigh: '在工作台录入各槽试管重量，至少一槽非零。',
  balance: '用交换推荐或定量补偿把合力降到阈值以内。',
  review: '核对最终合力与槽位重量，勾选确认后完成作业。',
};

/** 阈值比较容差，消除浮点噪声（与后端 1e-6 舍入思路一致） */
const EPS = 1e-9;

export interface StageCheck {
  /** 条件展示文案（含实时数值） */
  label: string;
  pass: boolean;
  /** 未满足时的明确提示 */
  failHint: string;
}

export interface StageGateContext {
  /** 作业在准备阶段选定的转子规格 */
  jobHoleCount: HoleCount | null;
  /** 工作台当前各槽重量 */
  weights: number[];
  threshold: number;
  /** 工作台当前合力（g）；尚未算出为 null */
  magnitude: number | null;
  /** 复核阶段：用户已勾选确认结果 */
  reviewConfirmed: boolean;
}

/** 当前待完成阶段的下标（0..3）；已完成作业恒为最后一阶 */
export function stageIndexOf(job: BalanceJob): number {
  return Math.min(job.records.length, STAGES.length - 1);
}

export function isJobCompleted(job: BalanceJob): boolean {
  return job.records.length >= STAGES.length;
}

export function currentStageOf(job: BalanceJob): JobStage {
  return STAGES[stageIndexOf(job)];
}

/** 某阶段的推进条件（实时计算，用于条件清单展示与推进校验） */
export function checksForStage(
  stage: JobStage,
  ctx: StageGateContext,
): StageCheck[] {
  switch (stage) {
    case 'prepare':
      return [
        {
          label:
            ctx.jobHoleCount === null
              ? '选择转子规格（未选择）'
              : `选择转子规格（已选 ${ctx.jobHoleCount} 孔）`,
          pass: ctx.jobHoleCount !== null,
          failHint: '请先选择本次作业使用的转子规格',
        },
      ];
    case 'weigh': {
      const nonZero = ctx.weights.filter((weight) => weight > 0).length;
      return [
        {
          label: `至少一槽重量非零（当前非零 ${nonZero} 槽）`,
          pass: nonZero >= 1,
          failHint: '请在工作台至少录入一槽非零重量',
        },
      ];
    }
    case 'balance':
      return [
        {
          label:
            ctx.magnitude === null
              ? '当前合力不超过阈值（合力计算中…）'
              : `当前合力不超过阈值（合力 ${fmt(ctx.magnitude)} g / 阈值 ${fmt(
                  ctx.threshold,
                )} g）`,
          pass: ctx.magnitude !== null && ctx.magnitude <= ctx.threshold + EPS,
          failHint:
            ctx.magnitude === null
              ? '合力尚未算出，请稍候再试'
              : `当前合力 ${fmt(ctx.magnitude)} g 超过阈值 ${fmt(
                  ctx.threshold,
                )} g，请先完成配平`,
        },
      ];
    case 'review':
      return [
        {
          label: '勾选确认配平结果',
          pass: ctx.reviewConfirmed,
          failHint: '请勾选「确认配平结果」',
        },
      ];
  }
}

/** 推进校验：全部条件满足返回 null，否则返回明确提示 */
export function gateMessage(
  stage: JobStage,
  ctx: StageGateContext,
): string | null {
  const failed = checksForStage(stage, ctx).filter((check) => !check.pass);
  if (failed.length === 0) return null;
  return `「${STAGE_LABELS[stage]}」阶段条件未满足：${failed
    .map((check) => check.failHint)
    .join('；')}`;
}
