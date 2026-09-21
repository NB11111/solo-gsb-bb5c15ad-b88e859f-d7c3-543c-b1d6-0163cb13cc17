import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnyPlan,
  BalanceMode,
  BalanceResponse,
  HoleCount,
  MeasurementRecord,
  SavedPlan,
  WorkbenchDraft,
} from './types';
import { fetchBalance } from './api/balance';
import {
  deleteMeasurement,
  deletePlan,
  loadDraft,
  loadMeasurements,
  loadPlans,
  persistDraft,
  saveMeasurement,
  savePlan,
} from './lib/storage';
import { RotorDiagram } from './components/RotorDiagram';
import { StatusPanel } from './components/StatusPanel';
import { RecommendPanel } from './components/RecommendPanel';
import { WeightTable } from './components/WeightTable';
import { PlanBar } from './components/PlanBar';
import { BatchPanel } from './components/BatchPanel';

const HOLE_OPTIONS: HoleCount[] = [8, 12, 24];
const DEFAULT_THRESHOLD = 1;
const DEFAULT_STEP = 0.5;
const DEFAULT_MAX_PER_SLOT = 10;

function emptyState(holeCount: HoleCount): WorkbenchDraft {
  return {
    holeCount,
    weights: new Array(holeCount).fill(0),
    locked: new Array(holeCount).fill(false),
    threshold: DEFAULT_THRESHOLD,
    mode: 'swap',
    step: DEFAULT_STEP,
    maxPerSlot: DEFAULT_MAX_PER_SLOT,
  };
}

function initialState(): WorkbenchDraft {
  const draft = loadDraft();
  if (
    draft &&
    HOLE_OPTIONS.includes(draft.holeCount) &&
    Array.isArray(draft.weights) &&
    draft.weights.length === draft.holeCount &&
    Array.isArray(draft.locked) &&
    draft.locked.length === draft.holeCount &&
    typeof draft.threshold === 'number'
  ) {
    // 兼容旧版本暂存（无 mode/step/maxPerSlot 字段）
    return {
      ...draft,
      mode: draft.mode === 'compensate' ? 'compensate' : 'swap',
      step: typeof draft.step === 'number' && draft.step > 0 ? draft.step : DEFAULT_STEP,
      maxPerSlot:
        typeof draft.maxPerSlot === 'number' && draft.maxPerSlot > 0
          ? draft.maxPerSlot
          : DEFAULT_MAX_PER_SLOT,
    };
  }
  return emptyState(12);
}

export default function App() {
  const [draft, setDraft] = useState<WorkbenchDraft>(initialState);
  const [result, setResult] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<SavedPlan[]>(() => loadPlans());
  const [measurements, setMeasurements] = useState<MeasurementRecord[]>(() =>
    loadMeasurements(),
  );
  const [activePlan, setActivePlan] = useState<AnyPlan | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const { holeCount, weights, locked, threshold, mode, step, maxPerSlot } = draft;

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  // 输入变化后本地暂存（防抖）
  useEffect(() => {
    const timer = window.setTimeout(() => persistDraft(draft), 300);
    return () => window.clearTimeout(timer);
  }, [draft]);

  // 实时请求后端计算（防抖）
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchBalance({
          holeCount,
          weights,
          locked,
          threshold,
          mode,
          step: mode === 'compensate' ? step : undefined,
          maxPerSlot: mode === 'compensate' ? maxPerSlot : undefined,
        });
        if (!cancelled) setResult(response);
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error ? requestError.message : '请求失败',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [holeCount, weights, locked, threshold, mode, step, maxPerSlot]);

  const rebuild = useCallback(
    (nextHoleCount: HoleCount) => {
      setDraft(emptyState(nextHoleCount));
      setActivePlan(null);
      setResetSignal((n) => n + 1);
    },
    [],
  );

  const setWeight = useCallback((index: number, value: number) => {
    setDraft((prev) => {
      const nextWeights = [...prev.weights];
      nextWeights[index] = value;
      return { ...prev, weights: nextWeights };
    });
  }, []);

  const toggleLock = useCallback(
    (index: number) => {
      setDraft((prev) => {
        const nextLocked = [...prev.locked];
        nextLocked[index] = !nextLocked[index];
        return { ...prev, locked: nextLocked };
      });
      if (locked[index]) showToast(`槽 ${index + 1} 已解锁`);
    },
    [locked, showToast],
  );

  const swap = useCallback(
    (from: number, to: number) => {
      if (locked[from] || locked[to]) return;
      if (from === to) return;
      setDraft((prev) => {
        const nextWeights = [...prev.weights];
        const tmp = nextWeights[from];
        nextWeights[from] = nextWeights[to];
        nextWeights[to] = tmp;
        return { ...prev, weights: nextWeights };
      });
      showToast(`槽 ${from + 1} 与槽 ${to + 1} 已换位`);
    },
    [locked, showToast],
  );

  const clearWeights = useCallback(() => {
    setDraft((prev) => ({ ...prev, weights: prev.weights.map(() => 0) }));
    setActivePlan(null);
    setResetSignal((n) => n + 1);
  }, []);

  const applyRecommendation = useCallback(() => {
    if (mode === 'compensate') {
      const plan = result?.compRecommendation;
      if (!plan) return;
      setDraft((prev) => ({ ...prev, weights: [...plan.finalWeights] }));
      setActivePlan(null);
      setResetSignal((n) => n + 1);
      showToast(
        `已叠加补偿：${plan.additions
          .map(({ slot, amount }) => `槽 ${slot + 1} +${amount}g`)
          .join('，')}，已重新计算`,
      );
      return;
    }
    const plan = result?.recommendation;
    if (!plan) return;
    setDraft((prev) => ({ ...prev, weights: [...plan.finalWeights] }));
    setActivePlan(null);
    setResetSignal((n) => n + 1);
    showToast(
      `已应用推荐：${plan.swaps
        .map(([a, b]) => `${a + 1}⇄${b + 1}`)
        .join('，')}，已重新计算`,
    );
  }, [mode, result, showToast]);

  const switchMode = useCallback(
    (nextMode: BalanceMode) => {
      setDraft((prev) => ({ ...prev, mode: nextMode }));
      setActivePlan(null);
    },
    [],
  );

  const setCompParam = useCallback(
    (patch: { step?: number; maxPerSlot?: number }) => {
      setDraft((prev) => ({ ...prev, ...patch }));
      setActivePlan(null);
    },
    [],
  );

  const handleSave = useCallback(
    (name: string) => {
      const plan: SavedPlan = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        savedAt: Date.now(),
        holeCount,
        weights,
        locked,
        threshold,
        mode,
        step,
        maxPerSlot,
      };
      setPlans(savePlan(plan));
      showToast(`方案「${name}」已保存到浏览器`);
    },
    [holeCount, weights, locked, threshold, mode, step, maxPerSlot, showToast],
  );

  const handleLoad = useCallback(
    (plan: SavedPlan) => {
      setDraft({
        holeCount: plan.holeCount,
        weights: [...plan.weights],
        locked: [...plan.locked],
        threshold: plan.threshold,
        mode: plan.mode === 'compensate' ? 'compensate' : 'swap',
        step: typeof plan.step === 'number' ? plan.step : DEFAULT_STEP,
        maxPerSlot:
          typeof plan.maxPerSlot === 'number'
            ? plan.maxPerSlot
            : DEFAULT_MAX_PER_SLOT,
      });
      setActivePlan(null);
      setResetSignal((n) => n + 1);
      showToast(`已载入方案「${plan.name}」`);
    },
    [showToast],
  );

  const handleDelete = useCallback(
    (id: string) => {
      setPlans(deletePlan(id));
      showToast('方案已删除');
    },
    [showToast],
  );

  // 保存称量快照：只读取当前重量写入本地存储，不改变任何配平状态
  const handleSaveSnapshot = useCallback(
    (batchNo: string) => {
      const record: MeasurementRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        batchNo,
        holeCount,
        weights: [...weights],
        threshold,
        savedAt: Date.now(),
      };
      const next = saveMeasurement(record);
      setMeasurements(next);
      const count = next.filter(
        (item) => item.batchNo === batchNo && item.holeCount === holeCount,
      ).length;
      showToast(`批次「${batchNo}」已保存第 ${count} 次称量快照`);
    },
    [holeCount, weights, threshold, showToast],
  );

  const handleDeleteMeasurement = useCallback(
    (id: string) => {
      setMeasurements(deleteMeasurement(id));
      showToast('测量记录已删除');
    },
    [showToast],
  );

  const lockedCount = useMemo(() => locked.filter(Boolean).length, [locked]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <span className="logo">⚖️</span>
          <div>
            <h1>离心机转子配平工作台</h1>
            <p>等角环形槽位 · 矢量实时合成 · 交换推荐 / 定量补偿</p>
          </div>
        </div>
        <div className="topbar-controls">
          <label className="control">
            转子规格
            <select
              value={holeCount}
              onChange={(event) => rebuild(Number(event.target.value) as HoleCount)}
            >
              {HOLE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} 孔
                </option>
              ))}
            </select>
          </label>
          <label className="control">
            失衡阈值 (g)
            <input
              type="number"
              min={0}
              step={0.1}
              className="threshold-input"
              value={threshold}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 0) {
                  setDraft((prev) => ({ ...prev, threshold: value }));
                }
              }}
            />
          </label>
          <span className="locked-count">已锁定 {lockedCount} 槽</span>
        </div>
      </header>

      <main className="layout">
        <div className="layout-left">
          <RotorDiagram
            result={result}
            weights={weights}
            locked={locked}
            onSwap={swap}
            onToggleLock={toggleLock}
            onLockedDrag={() => showToast('该槽位已锁定，不能参与换位')}
            activePlan={activePlan}
          />
          <p className="hint rotor-hint">
            操作：按住未锁定槽位拖到另一槽位完成换位；单击槽位切换锁定；
            红色箭头为失衡合力方向，虚线圆为阈值边界。
          </p>
        </div>

        <div className="layout-right">
          <StatusPanel result={result} loading={loading} error={error} />
          <RecommendPanel
            result={result}
            mode={mode}
            step={step}
            maxPerSlot={maxPerSlot}
            activePlan={activePlan}
            onSwitchMode={switchMode}
            onChangeCompParam={setCompParam}
            onApply={applyRecommendation}
            onPreview={setActivePlan}
          />
        </div>
      </main>

      <WeightTable
        holeCount={holeCount}
        weights={weights}
        locked={locked}
        activePlan={activePlan}
        resetSignal={resetSignal}
        onSetWeight={setWeight}
        onToggleLock={toggleLock}
        onClear={clearWeights}
      />

      <BatchPanel
        holeCount={holeCount}
        threshold={threshold}
        records={measurements}
        onSaveSnapshot={handleSaveSnapshot}
        onDeleteRecord={handleDeleteMeasurement}
      />

      <PlanBar
        plans={plans}
        draftValid
        onSave={handleSave}
        onLoad={handleLoad}
        onDelete={handleDelete}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
