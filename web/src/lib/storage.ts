import type {
  BalanceJob,
  MeasurementRecord,
  SavedPlan,
  WizardStageId,
  WorkbenchDraft,
} from '../types';

const PLANS_KEY = 'centrifuge-balance:saved-plans:v1';
const DRAFT_KEY = 'centrifuge-balance:draft:v1';
const MEASUREMENTS_KEY = 'centrifuge-balance:measurements:v1';
const JOBS_KEY = 'centrifuge-balance:jobs:v1';

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储不可用（隐私模式等）时静默降级
  }
}

export function loadPlans(): SavedPlan[] {
  const plans = readJSON<SavedPlan[]>(PLANS_KEY);
  return Array.isArray(plans) ? plans : [];
}

export function savePlan(plan: SavedPlan): SavedPlan[] {
  const plans = loadPlans().filter((item) => item.id !== plan.id);
  plans.unshift(plan);
  writeJSON(PLANS_KEY, plans);
  return plans;
}

export function deletePlan(id: string): SavedPlan[] {
  const plans = loadPlans().filter((item) => item.id !== id);
  writeJSON(PLANS_KEY, plans);
  return plans;
}

export function loadDraft(): WorkbenchDraft | null {
  return readJSON<WorkbenchDraft>(DRAFT_KEY);
}

export function persistDraft(draft: WorkbenchDraft): void {
  writeJSON(DRAFT_KEY, draft);
}

export function loadMeasurements(): MeasurementRecord[] {
  const records = readJSON<MeasurementRecord[]>(MEASUREMENTS_KEY);
  return Array.isArray(records) ? records : [];
}

export function saveMeasurement(record: MeasurementRecord): MeasurementRecord[] {
  const records = loadMeasurements().filter((item) => item.id !== record.id);
  records.unshift(record);
  writeJSON(MEASUREMENTS_KEY, records);
  return records;
}

export function deleteMeasurement(id: string): MeasurementRecord[] {
  const records = loadMeasurements().filter((item) => item.id !== id);
  writeJSON(MEASUREMENTS_KEY, records);
  return records;
}

/* ---------- 配平作业向导（仅浏览器本地） ---------- */

const STAGE_IDS: WizardStageId[] = ['prepare', 'weigh', 'balance', 'review'];

/** 从 localStorage 反序列化时做结构校验，丢弃损坏/旧版本数据 */
function sanitizeJob(raw: unknown): BalanceJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<BalanceJob>;
  if (
    typeof item.id !== 'string' ||
    typeof item.jobNo !== 'string' ||
    typeof item.createdAt !== 'number' ||
    typeof item.updatedAt !== 'number'
  ) {
    return null;
  }
  if (
    item.status !== 'in_progress' &&
    item.status !== 'paused' &&
    item.status !== 'completed'
  ) {
    return null;
  }
  if (
    !item.currentStage ||
    !STAGE_IDS.includes(item.currentStage as WizardStageId)
  ) {
    return null;
  }
  if (!item.stages || typeof item.stages !== 'object') return null;
  for (const id of STAGE_IDS) {
    const record = item.stages[id];
    if (!record || typeof record !== 'object' || typeof record.note !== 'string') {
      return null;
    }
  }
  return item as BalanceJob;
}

export function loadJobs(): BalanceJob[] {
  const jobs = readJSON<BalanceJob[]>(JOBS_KEY);
  if (!Array.isArray(jobs)) return [];
  return jobs.filter(sanitizeJob);
}

/** 写入单个作业（按 id upsert），返回更新后的全量列表（最近更新在前） */
export function saveJob(job: BalanceJob): BalanceJob[] {
  const jobs = loadJobs().filter((item) => item.id !== job.id);
  jobs.unshift(job);
  jobs.sort((a, b) => b.updatedAt - a.updatedAt);
  writeJSON(JOBS_KEY, jobs);
  return jobs;
}

export function deleteJob(id: string): BalanceJob[] {
  const jobs = loadJobs().filter((item) => item.id !== id);
  writeJSON(JOBS_KEY, jobs);
  return jobs;
}
