/**
 * 离心机转子配平核心算法
 *
 * 约定：
 *  - 0 号槽位于正上方（12 点钟方向），槽号沿顺时针递增；
 *  - 角度使用数学坐标（x 轴向右，y 轴向上，逆时针为正）参与矢量求和；
 *  - 失衡方向以「自正上方顺时针的角度」呈现给前端。
 *
 * 推荐枚举（mode = 'swap'，默认）：未锁定槽位之间的交换，至多两次。
 *  - 0 次交换（当前状态）参与整体排序但不会被作为“推荐方案”；
 *  - 单次交换为无序对 (i,j)；
 *  - 两次交换按「执行顺序」枚举有序的交换对 (i,j)->(k,l)，
 *    因此共享槽位的两次交换两种先后顺序都会被计算；
 *  - 排序键 = [失衡合力(四舍五入到 1e-6), 交换次数, 槽号序列...]，
 *    合力相同的同值方案按交换槽号字典序排序，次数少者优先。
 *
 * 定量补偿枚举（mode = 'compensate'）：样本位置不能交换时，
 * 在未锁定槽位中搜索至多两个加重位置，加重质量为步长 step 的整数倍、
 * 每槽不超过 maxPerSlot。
 *  - 候选包含 0 处加重（当前状态），但推荐只给真正加重的方案；
 *  - 排序键 = [合力(1e-6), 总加质量(1e-9), 使用槽数, (槽号,加量)...]；
 *  - 双槽组合固定第一槽档数 k1 时，残差关于 k2 为凸二次函数，先求连续
 *    最优 k2*，再在其附近取最近的 COMP_WINDOW 个离散整数；每片保留前
 *    MAX_ALTERNATIVES 个候选再全局合并，数学上保证全局前 6 不遗漏。
 */

const TAU = Math.PI * 2;
const EPS = 1e-9;
const ROUND_FACTOR = 1e6;
const MAX_ALTERNATIVES = 6;
/** 补偿枚举时每个连续最优点附近保留的离散档数窗口（≥ MAX_ALTERNATIVES+2） */
const COMP_WINDOW = 8;
/** 单槽允许的最大离散档数，限制最坏情况计算量 */
const MAX_COMP_STEPS = 2000;

export const SUPPORTED_HOLE_COUNTS = [8, 12, 24];

/** 槽位数学角（弧度，0 号槽在正上方，顺时针） */
export function slotAngleRad(index, holeCount) {
  return TAU / 4 - (index * TAU) / holeCount;
}

/** 槽位显示角（度，自正上方顺时针） */
export function slotAngleDeg(index, holeCount) {
  return (index * 360) / holeCount;
}

function round6(value) {
  return Math.round(value * ROUND_FACTOR) / ROUND_FACTOR;
}

/** 字典序：先比长度（交换次数），再逐位比槽号 */
function tupleLess(a, b) {
  if (a.length !== b.length) return a.length < b.length;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** 计算每个重量矢量及其合力 */
function computeSlots(weights, holeCount) {
  const slots = new Array(holeCount);
  let x = 0;
  let y = 0;
  for (let i = 0; i < holeCount; i += 1) {
    const angle = slotAngleRad(i, holeCount);
    const weight = weights[i];
    const sx = weight * Math.cos(angle);
    const sy = weight * Math.sin(angle);
    x += sx;
    y += sy;
    slots[i] = {
      index: i,
      weight,
      angleDeg: slotAngleDeg(i, holeCount),
      x: sx,
      y: sy,
    };
  }
  return { slots, resultant: { x, y, magnitude: Math.hypot(x, y) } };
}

/** 合力方向：自正上方顺时针的角度（度，0~360） */
function directionDegFromVector(x, y) {
  const deg = (90 - (Math.atan2(y, x) * 180) / Math.PI) % 360;
  return deg < 0 ? deg + 360 : deg;
}

function magnitudeOf(values, holeCount) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < holeCount; i += 1) {
    const angle = slotAngleRad(i, holeCount);
    x += values[i] * Math.cos(angle);
    y += values[i] * Math.sin(angle);
  }
  return Math.hypot(x, y);
}

/**
 * 枚举至多两次交换，返回按失衡合力升序排列的候选（含当前状态）。
 */
function enumerateSwaps(weights, holeCount, unlocked, currentMagnitude) {
  // 未锁定槽位间的所有无序对
  const pairs = [];
  for (let a = 0; a < unlocked.length; a += 1) {
    for (let b = a + 1; b < unlocked.length; b += 1) {
      pairs.push([unlocked[a], unlocked[b]]);
    }
  }

  // 预计算每一种单次交换后的重量数组（空交换对/同值交换跳过）
  const base = Float64Array.from(weights);
  const singles = new Array(pairs.length);
  for (let p = 0; p < pairs.length; p += 1) {
    const [i, j] = pairs[p];
    if (weights[i] === weights[j]) continue; // 同值交换无效果
    const arr = new Float64Array(base);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
    singles[p] = arr;
  }

  const ranked = [];

  const pushCandidate = (magnitude, tuple, swaps, values) => {
    const candidate = {
      magnitude: round6(magnitude),
      tuple,
      swaps,
      weights: Array.from(values),
    };
    if (
      ranked.length >= MAX_ALTERNATIVES &&
      candidate.magnitude > ranked[ranked.length - 1].magnitude + EPS
    ) {
      return;
    }
    let pos = ranked.length;
    for (let k = 0; k < ranked.length; k += 1) {
      const existing = ranked[k];
      if (
        candidate.magnitude < existing.magnitude - EPS ||
        (Math.abs(candidate.magnitude - existing.magnitude) <= EPS &&
          tupleLess(candidate.tuple, existing.tuple))
      ) {
        pos = k;
        break;
      }
    }
    if (pos < MAX_ALTERNATIVES) {
      ranked.splice(pos, 0, candidate);
      if (ranked.length > MAX_ALTERNATIVES) ranked.pop();
    }
  };

  let enumerated = 1; // 当前状态（0 次交换）
  pushCandidate(currentMagnitude, [], [], base);

  // 单次交换
  for (let p = 0; p < pairs.length; p += 1) {
    if (!singles[p]) continue;
    const [i, j] = pairs[p];
    enumerated += 1;
    pushCandidate(
      magnitudeOf(singles[p], holeCount),
      [1, i, j],
      [[i, j]],
      singles[p],
    );
  }

  // 两次交换（按执行顺序枚举）
  const tmp = new Float64Array(holeCount);
  for (let p = 0; p < pairs.length; p += 1) {
    if (!singles[p]) continue; // 第一次交换为同值空操作，结果等价于单次交换
    const [i, j] = pairs[p];
    for (let q = 0; q < pairs.length; q += 1) {
      if (q === p || !singles[q]) continue; // 同一交换重复 / 第二次为空操作
      const [k, l] = pairs[q];
      tmp.set(singles[p]);
      const t = tmp[k];
      tmp[k] = tmp[l];
      tmp[l] = t;
      enumerated += 1;
      pushCandidate(
        magnitudeOf(tmp, holeCount),
        [2, i, j, k, l],
        [
          [i, j],
          [k, l],
        ],
        tmp,
      );
    }
  }

  return { ranked, enumerated };
}

function toPlanDTO(candidate, currentMagnitude) {
  return {
    swaps: candidate.swaps,
    projectedMagnitude: candidate.magnitude,
    finalWeights: candidate.weights,
    improvement: round6(currentMagnitude - candidate.magnitude),
    tuple: candidate.tuple,
  };
}

function round9(value) {
  return Math.round(value * 1e9) / 1e9;
}

/**
 * 连续域上 |r + k1*v1 + k2*v2|² 在盒 [1,maxK]² 的最小值（仅用于逐对剪枝）。
 * 凸二次函数的盒约束最小只可能出现在：钳位后的无约束最优点（在内点域）
 * 或四条边上；每条边是一维二次函数，检查其投影最优点与两个角点即可。
 */
function continuousPairMinimum(rx, ry, v1x, v1y, v2x, v2y, stepSq, maxK) {
  const dot12 = v1x * v2x + v1y * v2y;
  const det = stepSq * stepSq - dot12 * dot12;
  let bestSq = Infinity;
  const evalPoint = (k1, k2) => {
    const dx = rx + k1 * v1x + k2 * v2x;
    const dy = ry + k1 * v1y + k2 * v2y;
    const value = dx * dx + dy * dy;
    if (value < bestSq) bestSq = value;
  };
  const clampK = (k) => Math.min(maxK, Math.max(1, k));

  if (Math.abs(det) > 1e-14) {
    // 无约束内点最优 k* = -G^{-1}b
    const b1 = rx * v1x + ry * v1y;
    const b2 = rx * v2x + ry * v2y;
    const k1u = (-stepSq * b1 + dot12 * b2) / det;
    const k2u = (dot12 * b1 - stepSq * b2) / det;
    if (k1u >= 1 && k1u <= maxK && k2u >= 1 && k2u <= maxK) {
      evalPoint(k1u, k2u);
    }
  }
  // 边 k1=1 / k1=maxK：沿 k2 一维投影，投影点加两角点
  for (const k1 of [1, maxK]) {
    const bx = rx + k1 * v1x;
    const by = ry + k1 * v1y;
    evalPoint(k1, 1);
    evalPoint(k1, maxK);
    evalPoint(k1, clampK(-(bx * v2x + by * v2y) / stepSq));
  }
  // 边 k2=1 / k2=maxK：沿 k1 一维投影
  for (const k2 of [1, maxK]) {
    const bx = rx + k2 * v2x;
    const by = ry + k2 * v2y;
    evalPoint(1, k2);
    evalPoint(maxK, k2);
    evalPoint(clampK(-(bx * v1x + by * v1y) / stepSq), k2);
  }
  return Math.sqrt(bestSq);
}

/**
 * 定量补偿枚举：在未锁定槽位中选择至多两个槽，各加 k*step（1 ≤ k ≤ maxK）。
 * ranked[0] 为含「不加任何质量」的全局最优（合力最小），长度至多
 * MAX_ALTERNATIVES。
 */
function enumerateCompensations(
  holeCount,
  unlocked,
  resultant,
  step,
  maxK,
) {
  const { x: rx, y: ry, magnitude: currentMagnitude } = resultant;
  const stepSq = step * step;

  // 每个未锁定槽的单步矢量 step*u（|v| = step）
  const vxArr = new Array(holeCount);
  const vyArr = new Array(holeCount);
  for (const i of unlocked) {
    const angle = slotAngleRad(i, holeCount);
    vxArr[i] = Math.cos(angle) * step;
    vyArr[i] = Math.sin(angle) * step;
  }

  // tuple 比较：[使用槽数, (槽号, 加量)...]，越靠前/加量小者优先
  const tupleLess = (a, b) => {
    const n = Math.max(a.length, b.length);
    for (let t = 0; t < n; t += 1) {
      const av = t < a.length ? a[t] : Infinity;
      const bv = t < b.length ? b[t] : Infinity;
      if (av !== bv) return av < bv;
    }
    return false;
  };

  /** 已按 (magnitude,totalMass,tuple) 有序的列表上的比较插入（热路径） */
  const insertTop = (list, item) => {
    if (list.length >= MAX_ALTERNATIVES) {
      const tail = list[list.length - 1];
      if (
        item.m > tail.m + EPS ||
        (Math.abs(item.m - tail.m) <= EPS &&
          (item.total > tail.total + 1e-9 ||
            (Math.abs(item.total - tail.total) <= 1e-9 &&
              !tupleLess(item.tuple, tail.tuple))))
      ) {
        return false;
      }
    }
    let pos = list.length;
    for (let k = 0; k < list.length; k += 1) {
      const e = list[k];
      if (
        item.m < e.m - EPS ||
        (Math.abs(item.m - e.m) <= EPS &&
          (item.total < e.total - 1e-9 ||
            (Math.abs(item.total - e.total) <= 1e-9 &&
              tupleLess(item.tuple, e.tuple))))
      ) {
        pos = k;
        break;
      }
    }
    if (pos >= MAX_ALTERNATIVES) return false;
    list.splice(pos, 0, item);
    if (list.length > MAX_ALTERNATIVES) list.pop();
    return true;
  };

  const ranked = [];
  let enumerated = 1; // 0 处加重
  insertTop(ranked, {
    m: currentMagnitude,
    magnitude: round6(currentMagnitude),
    total: 0,
    tuple: [0],
    additions: [],
  });

  // 连续最优点附近的离散整数窗口（预计算，避免热路径分配）。
  // 注意半径必须扩展到覆盖整个 [1,maxK]：当连续最优远离合法区间（最优 k* 很大）
  // 时，离散最优退化为边界点，绝不能提前停止。
  const nearBuf = new Int32Array(COMP_WINDOW);
  const fillNearest = (center, maxKCap) => {
    const base = Math.round(center);
    let count = 0;
    const maxRadius = Math.max(Math.abs(1 - base), Math.abs(maxKCap - base));
    for (let radius = 0; count < COMP_WINDOW && radius <= maxRadius; radius += 1) {
      const low = base - radius;
      const high = base + radius;
      if (low >= 1 && low <= maxKCap) nearBuf[count++] = low;
      if (radius > 0 && high >= 1 && high <= maxKCap) nearBuf[count++] = high;
    }
    return count;
  };

  // 单槽：|r + k*v|² 关于 k 为凸二次，连续最优 k* = -(r·v)/(v·v)
  for (const i of unlocked) {
    const vx = vxArr[i];
    const vy = vyArr[i];
    const kStar = -(rx * vx + ry * vy) / stepSq;
    const count = fillNearest(kStar, maxK);
    for (let z = 0; z < count; z += 1) {
      const k = nearBuf[z];
      enumerated += 1;
      const dx = rx + k * vx;
      const dy = ry + k * vy;
      const m = Math.sqrt(dx * dx + dy * dy);
      const amount = round9(k * step);
      insertTop(ranked, {
        m,
        magnitude: round6(m),
        total: amount,
        tuple: [1, i, amount],
        additions: [[i, k]],
      });
    }
  }

  // 双槽（无序对，i<j）：固定 k1 时关于 k2 的连续最优
  //   k2* = -(v2·(r + k1*v1)) / (v2·v2)
  // 每个 k1 切片先保前 MAX_ALTERNATIVES 再并入全局：
  // 对凸二次 |r+k1v1+k2v2|，若全局第 N 名在某片的 k2 处，则该片内至多有
  // N-1 个更优点（更优者在全局中也更优），故每片取前 N 即可保证全局前 N 不丢。
  for (let a = 0; a < unlocked.length; a += 1) {
    const i = unlocked[a];
    const v1x = vxArr[i];
    const v1y = vyArr[i];
    for (let b = a + 1; b < unlocked.length; b += 1) {
      const j = unlocked[b];
      const v2x = vxArr[j];
      const v2y = vyArr[j];

      // 逐对剪枝：该对连续域盒约束最小都进不了当前全局前 6，离散点更不可能
      if (ranked.length >= MAX_ALTERNATIVES) {
        const cMin = continuousPairMinimum(
          rx, ry, v1x, v1y, v2x, v2y, stepSq, maxK,
        );
        if (cMin > ranked[ranked.length - 1].m + EPS) continue;
      }

      const slice = [];
      for (let k1 = 1; k1 <= maxK; k1 += 1) {
        const baseX = rx + k1 * v1x;
        const baseY = ry + k1 * v1y;
        const k2Star = -(baseX * v2x + baseY * v2y) / stepSq;
        const count = fillNearest(k2Star, maxK);
        for (let z = 0; z < count; z += 1) {
          const k2 = nearBuf[z];
          enumerated += 1;
          const dx = baseX + k2 * v2x;
          const dy = baseY + k2 * v2y;
          const m = Math.sqrt(dx * dx + dy * dy);
          // 廉价淘汰：连该片前 N 都进不了就不构造 tuple/数组
          if (
            slice.length >= MAX_ALTERNATIVES &&
            m > slice[slice.length - 1].m + EPS
          ) {
            continue;
          }
          const a1 = round9(k1 * step);
          const a2 = round9(k2 * step);
          insertTop(slice, {
            m,
            magnitude: round6(m),
            total: round9(a1 + a2),
            tuple: [2, i, a1, j, a2],
            additions: [
              [i, k1],
              [j, k2],
            ],
          });
        }
      }
      for (const item of slice) insertTop(ranked, item);
    }
  }

  return { ranked, enumerated };
}

/** 补偿候选 -> 前端 DTO */
function toCompPlanDTO(candidate, weights, step, currentMagnitude) {
  const additions = candidate.additions.map(([slot, k]) => ({
    slot,
    amount: round9(k * step),
  }));
  const finalWeights = Array.from(weights);
  for (const { slot, amount } of additions) {
    finalWeights[slot] = round9(finalWeights[slot] + amount);
  }

  // 补偿后合力分量（用于前端矢量预览）
  let px = 0;
  let py = 0;
  for (let i = 0; i < finalWeights.length; i += 1) {
    const angle = slotAngleRad(i, finalWeights.length);
    px += finalWeights[i] * Math.cos(angle);
    py += finalWeights[i] * Math.sin(angle);
  }
  const projectedMagnitude = candidate.magnitude;
  let projectedDirectionDeg = null;
  if (projectedMagnitude > EPS) {
    projectedDirectionDeg = round6(directionDegFromVector(px, py));
  }

  return {
    additions,
    totalAdded: candidate.total,
    usedSlots: candidate.additions.length,
    projectedMagnitude,
    projectedX: round6(px),
    projectedY: round6(py),
    projectedDirectionDeg,
    finalWeights,
    improvement: round6(currentMagnitude - projectedMagnitude),
    tuple: candidate.tuple,
  };
}

function assertFiniteNumber(value, message) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(message);
  }
}

/**
 * 分析一次请求：矢量合力、状态与（超阈值时的）交换推荐。
 * 校验失败时抛出 Error（由路由转为 400）。
 */
export function analyze(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('请求体必须是 JSON 对象');
  }
  const {
    holeCount,
    weights,
    locked,
    threshold,
    mode = 'swap',
    step,
    maxPerSlot,
  } = input;

  if (mode !== 'swap' && mode !== 'compensate') {
    throw new Error("mode 仅支持 'swap'（交换推荐）或 'compensate'（定量补偿）");
  }
  if (!SUPPORTED_HOLE_COUNTS.includes(holeCount)) {
    throw new Error(
      `holeCount 仅支持 ${SUPPORTED_HOLE_COUNTS.join('/')} 孔转子`,
    );
  }
  if (!Array.isArray(weights) || weights.length !== holeCount) {
    throw new Error(`weights 必须是长度 ${holeCount} 的数组`);
  }
  if (!Array.isArray(locked) || locked.length !== holeCount) {
    throw new Error(`locked 必须是长度 ${holeCount} 的数组`);
  }
  assertFiniteNumber(threshold, 'threshold 必须是有限数值');
  if (threshold < 0) throw new Error('threshold 不能为负数');

  let normalizedStep = null;
  let normalizedMaxPerSlot = null;
  let maxK = 0;
  if (mode === 'compensate') {
    assertFiniteNumber(step, '定量补偿模式必须提供 step（补偿步长）');
    assertFiniteNumber(
      maxPerSlot,
      '定量补偿模式必须提供 maxPerSlot（每槽最大可加质量）',
    );
    if (step <= 0) throw new Error('step（补偿步长）必须为正数');
    if (maxPerSlot <= 0) throw new Error('maxPerSlot（每槽最大可加质量）必须为正数');
    if (maxPerSlot < step - 1e-9) {
      throw new Error('maxPerSlot 不能小于 step（至少要能加一个步长）');
    }
    normalizedStep = round9(step);
    normalizedMaxPerSlot = round9(maxPerSlot);
    maxK = Math.round(normalizedMaxPerSlot / normalizedStep);
    if (Math.abs(maxK * normalizedStep - normalizedMaxPerSlot) > 1e-6) {
      throw new Error('maxPerSlot 必须是 step 的整数倍（离散档数需为整数）');
    }
    if (maxK < 1) throw new Error('每槽至少要能加 1 个步长');
    if (maxK > MAX_COMP_STEPS) {
      throw new Error(
        `离散档数过多（maxPerSlot/step=${maxK}），上限为 ${MAX_COMP_STEPS} 档，请增大步长或减小每槽上限`,
      );
    }
  }

  const normalizedWeights = weights.map((w, i) => {
    assertFiniteNumber(w, `weights[${i}] 必须是有限数值`);
    if (w < 0) throw new Error(`weights[${i}] 不能为负数（空槽请填 0）`);
    return w;
  });
  const normalizedLocked = locked.map((v) => Boolean(v));

  const { slots, resultant } = computeSlots(
    normalizedWeights,
    holeCount,
  );

  let directionDeg = null;
  let nearestSlotIndex = null;
  if (resultant.magnitude > EPS) {
    directionDeg = round6(
      directionDegFromVector(resultant.x, resultant.y),
    );
    // 与合力夹角最小的槽位（单位矢量点积最大）
    let bestDot = -Infinity;
    for (let i = 0; i < holeCount; i += 1) {
      const angle = slotAngleRad(i, holeCount);
      const dot =
        (resultant.x * Math.cos(angle) +
          resultant.y * Math.sin(angle)) /
        resultant.magnitude;
      if (dot > bestDot) {
        bestDot = dot;
        nearestSlotIndex = i;
      }
    }
  }

  const magnitude = round6(resultant.magnitude);
  const status =
    magnitude <= EPS
      ? 'balanced'
      : magnitude > threshold + EPS
        ? 'over'
        : 'ok';

  const response = {
    holeCount,
    threshold,
    mode,
    status,
    slots,
    resultant: {
      x: round6(resultant.x),
      y: round6(resultant.y),
      magnitude,
      directionDeg,
      nearestSlotIndex,
    },
  };

  // 仅在超阈值时枚举推荐
  if (status === 'over') {
    const unlocked = normalizedLocked
      .map((isLocked, index) => (isLocked ? -1 : index))
      .filter((index) => index >= 0);

    if (mode === 'swap') {
      // 0/1 个未锁定槽位时无交换可言
      const { ranked, enumerated } = enumerateSwaps(
        normalizedWeights,
        holeCount,
        unlocked,
        magnitude,
      );
      const alternatives = ranked
        .filter((candidate) => candidate.tuple.length > 0)
        .map((candidate) => toPlanDTO(candidate, magnitude));
      response.enumeration = enumerated;
      response.recommendation = alternatives[0] ?? null;
      response.alternatives = alternatives;
    } else {
      // 定量补偿：至少需要 1 个未锁定槽位才能加重
      if (unlocked.length > 0) {
        const { ranked, enumerated } = enumerateCompensations(
          holeCount,
          unlocked,
          resultant,
          normalizedStep,
          maxK,
        );
        // ranked[0] 为含 0 处加重的全局最优，即离散可达的最小合力
        const minimum = ranked[0] ?? null;
        const minimumMagnitude = minimum ? minimum.magnitude : magnitude;
        // 可应用的方案：真正加重且严格优于当前状态（不加重）
        const actionable = ranked
          .filter(
            (candidate) =>
              candidate.additions.length > 0 &&
              candidate.magnitude < magnitude - EPS,
          )
          .map((candidate) =>
            toCompPlanDTO(candidate, normalizedWeights, normalizedStep, magnitude),
          );
        response.compStep = normalizedStep;
        response.compMaxPerSlot = normalizedMaxPerSlot;
        response.compEnumeration = enumerated;
        response.minimumMagnitude = minimumMagnitude;
        response.thresholdReachable = minimumMagnitude <= threshold + EPS;
        response.compRecommendation = actionable[0] ?? null;
        response.compAlternatives = actionable;
      } else {
        response.compStep = normalizedStep;
        response.compMaxPerSlot = normalizedMaxPerSlot;
        response.compEnumeration = 1;
        response.minimumMagnitude = magnitude;
        response.thresholdReachable = false;
        response.compRecommendation = null;
        response.compAlternatives = [];
      }
    }
  }

  return response;
}
