import { analyze } from './balancing.js';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name} ${detail}`);
  }
}

// 1) 对向放置等重试管 => 完全平衡
const balanced = new Array(12).fill(0);
balanced[0] = 10;
balanced[6] = 10;
const r1 = analyze({
  holeCount: 12,
  weights: balanced,
  locked: new Array(12).fill(false),
  threshold: 1,
});
check('对向等重 -> balanced', r1.status === 'balanced');
check('平衡时合力为 0', Math.abs(r1.resultant.magnitude) < 1e-9, JSON.stringify(r1.resultant));
check('平衡时无推荐', r1.recommendation === undefined);

// 2) 同侧重物 => 超阈值，推荐应把较重试管移到对侧
const weights2 = new Array(12).fill(0);
weights2[0] = 10;
weights2[1] = 10.2;
const r2 = analyze({
  holeCount: 12,
  weights: weights2,
  locked: new Array(12).fill(false),
  threshold: 1,
});
check('同侧两管 -> over', r2.status === 'over');
check('存在推荐', r2.recommendation !== null);
check(
  '推荐合力小于当前',
  r2.recommendation &&
    r2.recommendation.projectedMagnitude < r2.resultant.magnitude,
  `${r2.recommendation?.projectedMagnitude} < ${r2.resultant.magnitude}`,
);
check(
  '一次交换即可近似配平：槽0 的 10 移到槽 7（残差 0.2g，优于 10.2 移槽 7 的 5.2g）',
  JSON.stringify(r2.recommendation.swaps) === '[[0,7]]',
  JSON.stringify(r2.recommendation.swaps),
);
check(
  '方向角介于槽 0 与槽 1 之间（约 15°）',
  r2.resultant.directionDeg > 10 && r2.resultant.directionDeg < 20,
  String(r2.resultant.directionDeg),
);
check('nearestSlot 为 0 或 1', [0, 1].includes(r2.resultant.nearestSlotIndex));

// 3) 锁定槽位不参与交换
const weights3 = new Array(12).fill(0);
weights3[0] = 10;
weights3[1] = 10.2;
const locked3 = new Array(12).fill(false);
locked3[7] = true; // 锁住对侧目标槽
const r3 = analyze({
  holeCount: 12,
  weights: weights3,
  locked: locked3,
  threshold: 1,
});
const touchesLocked = r3.recommendation.swaps
  .flat()
  .some((slot) => slot === 7);
check('推荐不触碰锁定槽', !touchesLocked);
check('锁定时备选同样不含 7 槽', !r3.alternatives.some(
  (p) => p.swaps.flat().includes(7),
));

// 4) 全部锁定且超阈值 => 无推荐
const r4 = analyze({
  holeCount: 8,
  weights: [10, 10, 0, 0, 0, 0, 0, 0],
  locked: new Array(8).fill(true),
  threshold: 1,
});
check('全部锁定 -> over 且无推荐', r4.status === 'over' && r4.recommendation === null);
check('枚举数为 1', r4.enumeration === 1);

// 5) 枚举数核对（8 孔全解锁：1 + C(8,2) + P(8,2有效对...) ）
//    pairs=28，单次=28（重量互异），两次=28*27=756，合计 785
const r5 = analyze({
  holeCount: 8,
  weights: [1, 2, 3, 4, 5, 6, 7, 8],
  locked: new Array(8).fill(false),
  threshold: 0,
});
check('8 孔枚举总数 785', r5.enumeration === 785, String(r5.enumeration));

// 6) 同合力方案按次数、槽号排序
check(
  '备选按合力升序',
  r5.alternatives.every((p, i, arr) =>
    i === 0 ? true : p.projectedMagnitude >= arr[i - 1].projectedMagnitude - 1e-9,
  ),
);
const firstSingle = r5.alternatives.find((p) => p.swaps.length === 1);
const firstDouble = r5.alternatives.find((p) => p.swaps.length === 2);
check(
  '同合力单次优先于两次',
  !firstDouble ||
    !firstSingle ||
    firstDouble.projectedMagnitude > firstSingle.projectedMagnitude + 1e-9 ||
    r5.alternatives.indexOf(firstSingle) < r5.alternatives.indexOf(firstDouble),
);

// 7) 24 孔最坏情况性能
const t0 = performance.now();
const r7 = analyze({
  holeCount: 24,
  weights: Array.from({ length: 24 }, (_, i) => i + 1),
  locked: new Array(24).fill(false),
  threshold: 0,
});
const elapsed = performance.now() - t0;
check('24 孔枚举总数', r7.enumeration === 1 + 276 + 276 * 275, String(r7.enumeration));
check(`24 孔耗时 ${elapsed.toFixed(0)}ms < 500ms`, elapsed < 500);
check('备选至多 6 个', r7.alternatives.length <= 6);

// 8) 参数校验
let threw = false;
try {
  analyze({ holeCount: 10, weights: [], locked: [], threshold: 1 });
} catch {
  threw = true;
}
check('非法孔数抛错', threw);

threw = false;
try {
  analyze({ holeCount: 8, weights: new Array(8).fill(-1), locked: new Array(8).fill(false), threshold: 1 });
} catch {
  threw = true;
}
check('负重量抛错', threw);

// 9) finalWeights 与 swaps 一致（应用后结果即方案描述的结果）
for (const plan of r2.alternatives) {
  const expected = [...weights2];
  for (const [a, b] of plan.swaps) {
    const tmp = expected[a];
    expected[a] = expected[b];
    expected[b] = tmp;
  }
  check(
    `finalWeights 与交换序列一致 ${JSON.stringify(plan.swaps)}`,
    JSON.stringify(expected) === JSON.stringify(plan.finalWeights),
  );
}

// 10) 定量补偿模式
const compWeights = new Array(12).fill(0);
compWeights[0] = 10;
compWeights[1] = 10.2;
const rc = analyze({
  holeCount: 12,
  weights: compWeights,
  locked: new Array(12).fill(false),
  threshold: 1,
  mode: 'compensate',
  step: 0.2,
  maxPerSlot: 40,
});
check('补偿模式 over', rc.status === 'over');
check(
  '槽6加10、槽7加10.2 精确抵消',
  rc.compRecommendation &&
    rc.compRecommendation.projectedMagnitude === 0 &&
    JSON.stringify(rc.compRecommendation.additions) ===
      JSON.stringify([
        { slot: 6, amount: 10 },
        { slot: 7, amount: 10.2 },
      ]),
  JSON.stringify(rc.compRecommendation),
);
check('最小可达合力为 0', rc.minimumMagnitude === 0);
check('阈值可达标记', rc.thresholdReachable === true);
check('补偿备选至多 6 个', rc.compAlternatives.length <= 6);
check(
  '补偿使用槽数与加质量字段',
  rc.compRecommendation.usedSlots === 2 &&
    rc.compRecommendation.totalAdded === 20.2,
);
check(
  'finalWeights 为原重量叠加补偿量',
  rc.compRecommendation.finalWeights[6] === 10 &&
    rc.compRecommendation.finalWeights[7] === 10.2 &&
    rc.compRecommendation.finalWeights[0] === 10 &&
    rc.compRecommendation.finalWeights[1] === 10.2,
);
check(
  '补偿后合力分量与方向（精确抵消时为 null）',
  rc.compRecommendation.projectedX === 0 &&
    rc.compRecommendation.projectedY === 0 &&
    rc.compRecommendation.projectedDirectionDeg === null,
);

// 11) 补偿排序键：合力 -> 总加质量 -> 槽数 -> (槽号,加量)
for (let i = 1; i < rc.compAlternatives.length; i += 1) {
  const prev = rc.compAlternatives[i - 1];
  const cur = rc.compAlternatives[i];
  const ordered =
    cur.projectedMagnitude > prev.projectedMagnitude + 1e-9 ||
    (Math.abs(cur.projectedMagnitude - prev.projectedMagnitude) <= 1e-9 &&
      (cur.totalAdded > prev.totalAdded + 1e-9 ||
        (Math.abs(cur.totalAdded - prev.totalAdded) <= 1e-9 &&
          JSON.stringify(cur.tuple) >= JSON.stringify(prev.tuple))));
  check(
    `补偿备选有序 #${i}`,
    ordered,
    `${JSON.stringify(prev.tuple)} vs ${JSON.stringify(cur.tuple)}`,
  );
}

// 12) 锁定槽不可加重
const compLocked = new Array(12).fill(false);
compLocked[6] = true;
compLocked[7] = true;
const rcl = analyze({
  holeCount: 12,
  weights: compWeights,
  locked: compLocked,
  threshold: 1,
  mode: 'compensate',
  step: 0.5,
  maxPerSlot: 40,
});
const compTouchesLocked = rcl.compAlternatives.some((p) =>
  p.additions.some((a) => compLocked[a.slot]),
);
check('补偿候选不触碰锁定槽', !compTouchesLocked);

// 13) 无法达到阈值时明确给出最小可达合力
const rcu = analyze({
  holeCount: 12,
  weights: compWeights,
  locked: new Array(12).fill(false),
  threshold: 1,
  mode: 'compensate',
  step: 1,
  maxPerSlot: 5,
});
check('无法达阈值时 thresholdReachable=false', rcu.thresholdReachable === false);
check('最小可达合力大于阈值', rcu.minimumMagnitude > 1);
check('仍给出最优可行加重方案', rcu.compRecommendation !== null);
check(
  '最优方案严格优于不加重',
  rcu.compRecommendation.projectedMagnitude < rcu.resultant.magnitude - 1e-9,
);

// 14) 全部锁定 => 无补偿方案，最小合力即当前合力
const rca = analyze({
  holeCount: 8,
  weights: [10, 10, 0, 0, 0, 0, 0, 0],
  locked: new Array(8).fill(true),
  threshold: 1,
  mode: 'compensate',
  step: 1,
  maxPerSlot: 5,
});
check('全锁时无补偿推荐', rca.compRecommendation === null);
check(
  '全锁时最小合力等于当前合力',
  Math.abs(rca.minimumMagnitude - rca.resultant.magnitude) < 1e-9,
);
check('全锁时不可达阈值', rca.thresholdReachable === false);

// 15) 补偿参数校验
for (const [label, extra] of [
  ['非法 mode', { mode: 'rotate', step: 1, maxPerSlot: 5 }],
  ['缺 step', { mode: 'compensate', maxPerSlot: 5 }],
  ['step 非正', { mode: 'compensate', step: 0, maxPerSlot: 5 }],
  ['maxPerSlot 小于 step', { mode: 'compensate', step: 2, maxPerSlot: 1 }],
  ['非整数倍', { mode: 'compensate', step: 0.3, maxPerSlot: 1 }],
  ['档数超限', { mode: 'compensate', step: 0.01, maxPerSlot: 30 }],
]) {
  let compThrew = false;
  try {
    analyze({
      holeCount: 8,
      weights: new Array(8).fill(0),
      locked: new Array(8).fill(false),
      threshold: 1,
      ...extra,
    });
  } catch {
    compThrew = true;
  }
  check(`补偿参数校验：${label}`, compThrew);
}

// 16) 默认 mode 为 swap，老请求结构完全兼容
const rLegacy = analyze({
  holeCount: 12,
  weights: compWeights,
  locked: new Array(12).fill(false),
  threshold: 1,
});
check('默认 mode=swap', rLegacy.mode === 'swap');
check('老请求仍返回交换推荐', rLegacy.recommendation !== null);
check('老请求不含补偿字段', rLegacy.compRecommendation === undefined);
check('交换模式不含补偿字段', rc.recommendation === undefined);

// 17) 24 孔补偿最坏情况性能（K=2000）
const tc0 = performance.now();
analyze({
  holeCount: 24,
  weights: Array.from({ length: 24 }, (_, i) => i + 1),
  locked: new Array(24).fill(false),
  threshold: 0,
  mode: 'compensate',
  step: 0.01,
  maxPerSlot: 20,
});
const compElapsed = performance.now() - tc0;
check(`24 孔补偿最坏耗时 ${compElapsed.toFixed(0)}ms < 3000ms`, compElapsed < 3000);

console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
