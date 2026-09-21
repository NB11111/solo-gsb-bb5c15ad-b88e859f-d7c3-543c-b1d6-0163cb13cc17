import type { AnyPlan } from '../types';

/** 方案涉及的槽位（交换：交换对双方；补偿：加重槽） */
export function planSlotSet(plan: AnyPlan | null): Set<number> {
  const set = new Set<number>();
  if (!plan) return set;
  if (plan.kind === 'swap') {
    plan.swaps.forEach(([a, b]) => {
      set.add(a);
      set.add(b);
    });
  } else {
    plan.additions.forEach(({ slot }) => set.add(slot));
  }
  return set;
}

/** 槽位 -> 补偿加质量（仅补偿模式有值） */
export function planAdditionMap(
  plan: AnyPlan | null,
): Map<number, number> {
  const map = new Map<number, number>();
  if (plan && plan.kind === 'compensate') {
    plan.additions.forEach(({ slot, amount }) => map.set(slot, amount));
  }
  return map;
}
