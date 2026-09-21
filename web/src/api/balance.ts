import type {
  BalanceRequest,
  BalanceResponse,
  CompensationPlan,
  SwapPlan,
} from '../types';

/** 后端 DTO 不带 kind，这里按所在字段归一化为可辨识联合类型 */
function normalize(response: BalanceResponse): BalanceResponse {
  if (response.mode === 'compensate') {
    const tag = (plan: CompensationPlan): CompensationPlan => ({
      ...plan,
      kind: 'compensate',
    });
    return {
      ...response,
      compRecommendation:
        response.compRecommendation === null ||
        response.compRecommendation === undefined
          ? null
          : tag(response.compRecommendation),
      compAlternatives: (response.compAlternatives ?? []).map(tag),
    };
  }
  const tag = (plan: SwapPlan): SwapPlan => ({ ...plan, kind: 'swap' });
  return {
    ...response,
    recommendation:
      response.recommendation === null ||
      response.recommendation === undefined
        ? null
        : tag(response.recommendation),
    alternatives: (response.alternatives ?? []).map(tag),
  };
}

export async function fetchBalance(
  request: BalanceRequest,
): Promise<BalanceResponse> {
  const response = await fetch('/api/balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    let message = `服务端返回 ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // 忽略非 JSON 错误体
    }
    throw new Error(message);
  }
  return normalize((await response.json()) as BalanceResponse);
}
