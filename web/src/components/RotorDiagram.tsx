import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnyPlan, BalanceResponse } from '../types';
import { planAdditionMap, planSlotSet } from '../lib/plan';
import { fmt } from '../lib/format';

const SIZE = 460;
const CENTER = SIZE / 2;
const RING_R = 172;
const SLOT_R = 27;
const TAU = Math.PI * 2;

interface RotorDiagramProps {
  result: BalanceResponse | null;
  weights: number[];
  locked: boolean[];
  onSwap: (from: number, to: number) => void;
  onToggleLock: (index: number) => void;
  onLockedDrag: () => void;
  activePlan: AnyPlan | null;
}

/** 0 基槽号 -> SVG 坐标（0 号在正上方，顺时针） */
function slotPosition(index: number, count: number): { x: number; y: number } {
  const angle = (index * TAU) / count;
  return {
    x: CENTER + RING_R * Math.sin(angle),
    y: CENTER - RING_R * Math.cos(angle),
  };
}

export function RotorDiagram({
  result,
  weights,
  locked,
  onSwap,
  onToggleLock,
  onLockedDrag,
  activePlan,
}: RotorDiagramProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ index: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);

  const count = result?.holeCount ?? weights.length;
  const maxWeight = Math.max(...weights, 0);
  const maxVectorScale = Math.max(maxWeight, result?.threshold ?? 0, 0.001);

  const positions = useMemo(
    () =>
      Array.from({ length: count }, (_, index) =>
        slotPosition(index, count),
      ),
    [count],
  );

  // 推荐方案涉及的槽位高亮
  const planSlots = useMemo(() => planSlotSet(activePlan), [activePlan]);
  const additionMap = useMemo(
    () => planAdditionMap(activePlan),
    [activePlan],
  );
  const compensation = activePlan?.kind === 'compensate' ? activePlan : null;

  const toSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: CENTER, y: CENTER };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * SIZE,
      y: ((clientY - rect.top) / rect.height) * SIZE,
    };
  };

  const slotAtPoint = (x: number, y: number): number | null => {
    for (let i = 0; i < positions.length; i += 1) {
      const pos = positions[i];
      if (Math.hypot(x - pos.x, y - pos.y) <= SLOT_R + 6) return i;
    }
    return null;
  };

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const point = toSvgPoint(event.clientX, event.clientY);
      setPointer(point);
      setHoverSlot(slotAtPoint(point.x, point.y));
    };
    const handleUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = toSvgPoint(event.clientX, event.clientY);
      const target = slotAtPoint(point.x, point.y);
      if (target === null) {
        // 落点不在槽上：可能是点了锁按钮以外的区域，不做处理
      } else if (target === drag.index) {
        onToggleLock(drag.index);
      } else if (locked[target]) {
        onLockedDrag();
      } else {
        onSwap(drag.index, target);
      }
      dragRef.current = null;
      setDragging(null);
      setPointer(null);
      setHoverSlot(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
    // positions 随转子规格变化重建；闭包内读取最新 props 的成本低于重复绑定
  });

  const startDrag = (
    event: React.PointerEvent<SVGGElement>,
    index: number,
  ) => {
    event.preventDefault();
    if (locked[index]) {
      // 锁定槽位不可拖动，单击即解锁
      onToggleLock(index);
      return;
    }
    const point = toSvgPoint(event.clientX, event.clientY);
    dragRef.current = { index, x: point.x, y: point.y };
    setDragging(index);
    setPointer(point);
  };

  const status = result?.status ?? 'balanced';
  const resultant = result?.resultant;
  const arrowScale = 120 / maxVectorScale;
  const arrowLen = Math.min(
    150,
    Math.max(resultant && resultant.magnitude > 0 ? 14 : 0, (resultant?.magnitude ?? 0) * arrowScale),
  );
  const arrowAngle =
    resultant && resultant.directionDeg !== null
      ? (resultant.directionDeg * Math.PI) / 180
      : 0;
  const arrowTip = {
    x: CENTER + arrowLen * Math.sin(arrowAngle),
    y: CENTER - arrowLen * Math.cos(arrowAngle),
  };
  const arrowColor =
    status === 'over' ? '#ff5d73' : status === 'ok' ? '#f0b429' : '#3ddc97';
  const thresholdRingR = Math.min(
    RING_R - SLOT_R - 14,
    Math.max(10, (result?.threshold ?? 0) * arrowScale),
  );

  const statusText =
    status === 'over' ? '超阈值' : status === 'ok' ? '阈值内' : '完全平衡';

  return (
    <div className="rotor-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="rotor-svg"
        role="img"
        aria-label="转子槽位环形图，可拖拽换位"
      >
        <defs>
          <radialGradient id="hub" cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor="#27364f" />
            <stop offset="100%" stopColor="#101a2b" />
          </radialGradient>
          <marker
            id="arrowhead"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={arrowColor} />
          </marker>
        </defs>

        {/* 外环与中心毂 */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RING_R + SLOT_R + 10}
          className="rotor-disc"
        />
        <circle cx={CENTER} cy={CENTER} r={62} fill="url(#hub)" />

        {/* 阈值参考圈 */}
        {thresholdRingR > 12 && (
          <circle
            cx={CENTER}
            cy={CENTER}
            r={thresholdRingR}
            className="threshold-ring"
            strokeDasharray="5 6"
          />
        )}

        {/* 各重量矢量（细参考线） */}
        {result?.slots.map((slot) => {
          if (slot.weight <= 0) return null;
          const len = Math.min(
            RING_R - SLOT_R - 18,
            slot.weight * arrowScale,
          );
          const angle = (slot.angleDeg * Math.PI) / 180;
          return (
            <line
              key={`vec-${slot.index}`}
              x1={CENTER}
              y1={CENTER}
              x2={CENTER + len * Math.sin(angle)}
              y2={CENTER - len * Math.cos(angle)}
              className="slot-vector"
            />
          );
        })}

        {/* 合力箭头 */}
        {resultant && resultant.magnitude > 0 && (
          <g>
            <line
              x1={CENTER}
              y1={CENTER}
              x2={arrowTip.x}
              y2={arrowTip.y}
              stroke={arrowColor}
              strokeWidth={4}
              strokeLinecap="round"
              markerEnd="url(#arrowhead)"
            />
            <text
              x={arrowTip.x}
              y={arrowTip.y}
              className="arrow-label"
              fill={arrowColor}
              textAnchor={arrowTip.x > CENTER + 8 ? 'start' : arrowTip.x < CENTER - 8 ? 'end' : 'middle'}
              dy={arrowTip.y < CENTER ? -8 : 16}
            >
              {fmt(resultant.magnitude)} g
            </text>
          </g>
        )}

        {/* 定量补偿预览：加重矢量（蓝）与补偿后合力（绿虚线） */}
        {compensation &&
          compensation.additions.map(({ slot, amount }) => {
            const angle = (slot * TAU) / count;
            const len = Math.min(RING_R - SLOT_R - 18, amount * arrowScale);
            return (
              <g key={`comp-${slot}`}>
                <line
                  x1={CENTER}
                  y1={CENTER}
                  x2={CENTER + len * Math.sin(angle)}
                  y2={CENTER - len * Math.cos(angle)}
                  stroke="#4da3ff"
                  strokeWidth={3}
                  strokeLinecap="round"
                  opacity={0.9}
                />
              </g>
            );
          })}
        {compensation && compensation.projectedMagnitude > 0 && (
          (() => {
            const pAngle =
              compensation.projectedDirectionDeg !== null
                ? (compensation.projectedDirectionDeg * Math.PI) / 180
                : 0;
            const pLen = Math.min(
              150,
              Math.max(
                10,
                compensation.projectedMagnitude * arrowScale,
              ),
            );
            const pTip = {
              x: CENTER + pLen * Math.sin(pAngle),
              y: CENTER - pLen * Math.cos(pAngle),
            };
            return (
              <g>
                <line
                  x1={CENTER}
                  y1={CENTER}
                  x2={pTip.x}
                  y2={pTip.y}
                  stroke="#3ddc97"
                  strokeWidth={3}
                  strokeDasharray="7 5"
                  strokeLinecap="round"
                />
                <text
                  x={pTip.x}
                  y={pTip.y}
                  className="arrow-label"
                  fill="#3ddc97"
                  textAnchor={pTip.x > CENTER + 8 ? 'start' : pTip.x < CENTER - 8 ? 'end' : 'middle'}
                  dy={pTip.y < CENTER ? -8 : 16}
                >
                  补偿后 {fmt(compensation.projectedMagnitude)} g
                </text>
              </g>
            );
          })()
        )}
        {compensation && compensation.projectedMagnitude === 0 && (
          <text
            x={CENTER}
            y={CENTER + 34}
            textAnchor="middle"
            className="hub-sub"
            fill="#3ddc97"
          >
            补偿后完全抵消
          </text>
        )}

        {/* 中心状态 */}
        <text x={CENTER} y={CENTER - 4} textAnchor="middle" className="hub-text">
          {statusText}
        </text>
        <text x={CENTER} y={CENTER + 16} textAnchor="middle" className="hub-sub">
          {fmt(resultant?.magnitude ?? 0)} / {fmt(result?.threshold ?? 0)} g
        </text>

        {/* 槽位 */}
        {positions.map((pos, index) => {
          const isLocked = locked[index];
          const isDragging = dragging === index;
          const isHover = hoverSlot === index && dragging !== null;
          const inPlan = planSlots.has(index);
          const isNearest = resultant?.nearestSlotIndex === index && status === 'over';
          const weight = weights[index];
          return (
            <g
              key={index}
              transform={`translate(${pos.x}, ${pos.y})`}
              className={`slot ${isLocked ? 'slot-locked' : 'slot-open'} ${
                isHover && !isLocked ? 'slot-hover' : ''
              } ${inPlan ? 'slot-plan' : ''} ${
                isNearest ? 'slot-nearest' : ''
              } ${isDragging ? 'slot-dragging' : ''}`}
              onPointerDown={(event) => startDrag(event, index)}
            >
              <circle r={SLOT_R} className="slot-circle" />
              <text y={-4} textAnchor="middle" className="slot-weight">
                {fmt(weight)}
              </text>
              <text y={12} textAnchor="middle" className="slot-index">
                {isLocked ? '🔒 ' : ''}
                {index + 1}
              </text>
              {additionMap.has(index) && (
                <text y={-SLOT_R - 6} textAnchor="middle" className="comp-badge">
                  +{fmt(additionMap.get(index))}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* 拖拽时跟随手指的虚影 */}
      {dragging !== null && pointer && (
        <div
          className="drag-ghost"
          style={{
            left: `${(pointer.x / SIZE) * 100}%`,
            top: `${(pointer.y / SIZE) * 100}%`,
          }}
        >
          <span>{fmt(weights[dragging])}</span>
        </div>
      )}
    </div>
  );
}
