import type {
  BalanceJob,
  MeasurementRecord,
  SavedPlan,
  WorkbenchDraft,
} from '../types';

const PLANS_KEY = 'centrifuge-balance:saved-plans:v1';
const DRAFT_KEY = 'centrifuge-balance:draft:v1';
const MEASUREMENTS_KEY = 'centrifuge-balance:measurements:v1';
const JOBS_KEY = 'centrifuge-balance:jobs:v1';
const ACTIVE_JOB_KEY = 'centrifuge-balance:active-job:v1';

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

export function loadJobs(): BalanceJob[] {
  const jobs = readJSON<BalanceJob[]>(JOBS_KEY);
  return Array.isArray(jobs) ? jobs : [];
}

/** 作业更新频繁（推进/回退/暂停），整体写回 */
export function persistJobs(jobs: BalanceJob[]): void {
  writeJSON(JOBS_KEY, jobs);
}

export function loadActiveJobId(): string | null {
  const id = readJSON<string>(ACTIVE_JOB_KEY);
  return typeof id === 'string' ? id : null;
}

export function persistActiveJobId(id: string | null): void {
  writeJSON(ACTIVE_JOB_KEY, id);
}
