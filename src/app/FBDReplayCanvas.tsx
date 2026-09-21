import { fbdBodyCorners, fbdBodyEndpointLabelPositions, fbdEndpointLabels, fbdMemberEndpointLabelPositions,
  type FBDPoint, type FBDState } from './statics/fbdState';
import { fbdJointSymbol } from './statics/fbdJointSymbol';
import { fbdGridLineConflicts, fbdGridReading, fbdGridSpec } from './statics/fbdGrid';
import type { StaticsWorkspace } from './statics/model';

export function ReplayCanvas({ state, workspace }: { state: FBDState; workspace?: StaticsWorkspace }) {
  const points: FBDPoint[] = [
    ...(state.bodies || []).flatMap((item) => fbdBodyCorners(item)),
    ...(state.joints || []).map((item) => item.at),
    ...(state.members || []).flatMap((item) => [item.start, item.end]),
    ...state.forces.map((item) => item.at), ...state.moments.map((item) => item.at),
    ...state.dimensions.flatMap((item) => [item.start, item.end]),
    ...state.angles.flatMap((item) => [item.vertex, item.from, item.to]),
    ...state.labels.map((item) => item.at),
  ];
  const rawMinX = Math.min(0, ...points.map((point) => point.x));
  const rawMaxX = Math.max(1, ...points.map((point) => point.x));
  const rawMinY = Math.min(0, ...points.map((point) => point.y));
  const rawMaxY = Math.max(1, ...points.map((point) => point.y));
  const rawSpan = Math.max(rawMaxX - rawMinX, rawMaxY - rawMinY, 1);
  const grid = fbdGridSpec({ x: (rawMinX + rawMaxX) / 2, y: (rawMinY + rawMaxY) / 2 }, rawSpan);
  const geometrySegments = [
    ...(state.members || []).map((member) => ({ start: member.start, end: member.end })),
    ...(state.bodies || []).flatMap((body) => {
      const corners = fbdBodyCorners(body);
      return corners.map((start, index) => ({ start, end: corners[(index + 1) % corners.length] }));
    }),
  ];
  const conflictTolerance = Math.max(grid.step * 0.035, 1e-8);
  const minX = points.length ? grid.xValues[0] : rawMinX;
  const maxX = points.length ? grid.xValues[grid.xValues.length - 1] : rawMaxX;
  const minY = points.length ? grid.yValues[0] : rawMinY;
  const maxY = points.length ? grid.yValues[grid.yValues.length - 1] : rawMaxY;
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = Math.min(650 / Math.max(maxX - minX, 1), 310 / Math.max(maxY - minY, 1));
  const sx = (x: number) => 400 + (x - (minX + maxX) / 2) * scale;
  const sy = (y: number) => 220 - (y - (minY + maxY) / 2) * scale;
  const line = (a: FBDPoint, b: FBDPoint, color: string, width = 2) =>
    <line x1={sx(a.x)} y1={sy(a.y)} x2={sx(b.x)} y2={sy(b.y)} stroke={color} strokeWidth={width} />;
  const text = (value: string, at: FBDPoint, color: string, yOffset = -8) =>
    <text x={sx(at.x)} y={sy(at.y) + yOffset} textAnchor="middle" dominantBaseline="middle"
      fill={color} fontSize="16"
      fontWeight="600" stroke="white" strokeWidth="4" paintOrder="stroke">{value}</text>;
  const anglePoint = (at: FBDPoint, radians: number, length: number) =>
    ({ x: at.x + Math.cos(radians) * length, y: at.y + Math.sin(radians) * length });
  const hasWork = (state.bodies?.length || 0) + (state.joints?.length || 0) + (state.members?.length || 0) +
    state.forces.length + state.moments.length + state.dimensions.length +
    state.angles.length + state.labels.length > 0;

  return <svg viewBox="0 0 800 440" role="img" aria-label="Read-only FBD replay"
    className="h-full min-h-[360px] w-full rounded border border-slate-200 bg-slate-50">
    <defs><marker id="replay-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5"
      orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#dc2626" /></marker>
      <marker id="replay-moment-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5"
        orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#7c3aed" /></marker></defs>
    {points.length > 0 && <g aria-label="Coordinate grid">
      {grid.xValues.filter((x) => !fbdGridLineConflicts('x', x, geometrySegments, conflictTolerance))
        .map((x) => <g key={`grid-x-${x}`}>
        {line({ x, y: minY }, { x, y: maxY }, Math.abs(x) < grid.step / 100 ? '#94a3b8' : '#e2e8f0', 1)}
        <text x={sx(x)} y={sy(minY) + 18} textAnchor="middle" fill="#64748b" fontSize="11">
          {fbdGridReading(x)}</text>
      </g>)}
      {grid.yValues.filter((y) => !fbdGridLineConflicts('y', y, geometrySegments, conflictTolerance))
        .map((y) => <g key={`grid-y-${y}`}>
        {line({ x: minX, y }, { x: maxX, y }, Math.abs(y) < grid.step / 100 ? '#94a3b8' : '#e2e8f0', 1)}
        <text x={sx(minX) - 10} y={sy(y) + 4} textAnchor="end" fill="#64748b" fontSize="11">
          {fbdGridReading(y)}</text>
      </g>)}
      <text x={sx(maxX)} y={sy(minY) + 34} textAnchor="end" fill="#475569" fontSize="12">
        x ({workspace?.units.length || 'units'})</text>
      <text x={sx(minX) - 10} y={sy(maxY) - 8} textAnchor="end" fill="#475569" fontSize="12">
        y ({workspace?.units.length || 'units'})</text>
    </g>}
    {(state.bodies || []).map((body) => <g key={body.id}>
      <polygon points={fbdBodyCorners(body).map((point) => `${sx(point.x)},${sy(point.y)}`).join(' ')}
        fill="#f8fafc" stroke="#059669" strokeWidth="3" />
      {fbdEndpointLabels(body.label || body.id) ? <>
        {text(fbdEndpointLabels(body.label || body.id)![0],
          fbdBodyEndpointLabelPositions(body, Math.max(0.28, span * 0.075))[0], '#047857', 0)}
        {text(fbdEndpointLabels(body.label || body.id)![1],
          fbdBodyEndpointLabelPositions(body, Math.max(0.28, span * 0.075))[1], '#047857', 0)}
      </> : body.label && text(body.label, { x: (fbdBodyCorners(body)[0].x + fbdBodyCorners(body)[2].x) / 2,
        y: (fbdBodyCorners(body)[0].y + fbdBodyCorners(body)[2].y) / 2 }, '#047857')}</g>)}
    {(state.members || []).map((member) => <g key={member.id}>{line(member.start, member.end, '#059669', 7)}
      {fbdEndpointLabels(member.label || member.id) ? <>
        {text(fbdEndpointLabels(member.label || member.id)![0],
          fbdMemberEndpointLabelPositions(member, Math.max(0.28, span * 0.075))[0], '#047857', 0)}
        {text(fbdEndpointLabels(member.label || member.id)![1],
          fbdMemberEndpointLabelPositions(member, Math.max(0.28, span * 0.075))[1], '#047857', 0)}
      </> : member.label && text(member.label, { x: (member.start.x + member.end.x) / 2,
        y: (member.start.y + member.end.y) / 2 }, '#047857')}</g>)}
    {(state.joints || []).map((node) => <g key={node.id}>
      {fbdJointSymbol(node.kind).strokes.map((stroke, index) =>
        <g key={`stroke-${index}`}>{line(
          { x: node.at.x + stroke.from.x, y: node.at.y + stroke.from.y },
          { x: node.at.x + stroke.to.x, y: node.at.y + stroke.to.y }, '#047857', 2.5)}</g>)}
      {fbdJointSymbol(node.kind).circles.map((circle, index) =>
        <circle key={`circle-${index}`} cx={sx(node.at.x + circle.center.x)}
          cy={sy(node.at.y + circle.center.y)} r={circle.radius * scale}
          fill={circle.filled ? '#047857' : 'none'} stroke="#047857" strokeWidth="2.5" />)}
      {node.label && text(node.label, { x: node.at.x, y: node.at.y + span * 0.09 }, '#065f46')}
    </g>)}
    {state.forces.map((force) => {
      const end = anglePoint(force.at, force.angle * Math.PI / 180, Math.max(0.75, span * 0.22));
      return <g key={force.id}><line x1={sx(force.at.x)} y1={sy(force.at.y)} x2={sx(end.x)} y2={sy(end.y)}
        stroke="#dc2626" strokeWidth="3" markerEnd="url(#replay-arrow)" />
        {text(`${force.label || 'F'}${force.magnitude === undefined ? '' : ` = ${force.magnitude}`}`,
          force.labelPosition || end, '#991b1b')}</g>;
    })}
    {state.moments.map((moment) => {
      const radius = Math.max(0.3, span * 0.1);
      const arc = Array.from({ length: 33 }, (_, index) => anglePoint(moment.at,
        -3 * Math.PI / 4 + (moment.clockwise ? -1 : 1) * 3 * Math.PI / 2 * index / 32, radius));
      return <g key={moment.id}><polyline points={arc.map((point) => `${sx(point.x)},${sy(point.y)}`).join(' ')}
        fill="none" stroke="#7c3aed" strokeWidth="3" markerEnd="url(#replay-moment-arrow)" />
        {text(`${moment.label || 'M'}${moment.magnitude === undefined ? '' : ` = ${moment.magnitude}`}`,
          moment.labelPosition || { x: moment.at.x, y: moment.at.y + radius * 1.6 }, '#6d28d9')}</g>;
    })}
    {state.dimensions.map((dimension) => {
      const dx = dimension.end.x - dimension.start.x;
      const dy = dimension.end.y - dimension.start.y;
      const length = Math.hypot(dx, dy) || 1;
      const offset = Math.max(0.3, span * 0.1);
      const normal = { x: -dy / length * offset, y: dx / length * offset };
      const a = { x: dimension.start.x + normal.x, y: dimension.start.y + normal.y };
      const b = { x: dimension.end.x + normal.x, y: dimension.end.y + normal.y };
      return <g key={dimension.id}>{line(dimension.start, a, '#0891b2')}
        {line(a, b, '#0891b2')}{line(b, dimension.end, '#0891b2')}
        {text(dimension.label || '', dimension.labelPosition ||
          { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, '#0e7490')}</g>;
    })}
    {state.angles.map((angle) => {
      const start = Math.atan2(angle.from.y - angle.vertex.y, angle.from.x - angle.vertex.x);
      const end = Math.atan2(angle.to.y - angle.vertex.y, angle.to.x - angle.vertex.x);
      const sweep = Math.atan2(Math.sin(end - start), Math.cos(end - start));
      const radius = Math.max(0.28, span * 0.08);
      const arc = Array.from({ length: 25 }, (_, index) => anglePoint(angle.vertex,
        start + sweep * index / 24, radius));
      return <g key={angle.id}>{line(angle.vertex, angle.from, '#0d9488')}
        {line(angle.vertex, angle.to, '#0d9488')}
        <polyline points={arc.map((point) => `${sx(point.x)},${sy(point.y)}`).join(' ')}
          fill="none" stroke="#0d9488" strokeWidth="2" />
        {text(angle.label || '', angle.labelPosition || anglePoint(angle.vertex,
          start + sweep / 2, radius * 1.5), '#0f766e')}</g>;
    })}
    {state.labels.map((label) => <g key={label.id}>{text(label.text, label.at, '#1e293b')}</g>)}
    {!hasWork && <text x="400" y="220" textAnchor="middle" fill="#64748b" fontSize="18">
      No diagram yet. Start building your free-body diagram.</text>}
  </svg>;
}
