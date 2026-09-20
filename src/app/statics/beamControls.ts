import type { StaticsLoad, StaticsSupport, StaticsWorkspace } from './model.ts';

type SupportSelection = StaticsSupport['kind'] | 'none';

export interface BeamControls {
  length: number;
  loadMagnitude: number | null;
  loadPosition: number;
  supportA: SupportSelection;
  supportB: SupportSelection;
}

function beamParts(workspace: StaticsWorkspace) {
  if (workspace.members.length !== 1) return null;
  const member = workspace.members[0];
  const start = workspace.nodes.find((node) => node.id === member.startNodeId);
  const end = workspace.nodes.find((node) => node.id === member.endNodeId);
  if (!start || !end || start.y !== end.y || start.x === end.x) return null;
  const [left, right] = start.x < end.x ? [start, end] : [end, start];
  const interior = workspace.nodes.filter((node) => node.id !== left.id && node.id !== right.id &&
    node.y === left.y && node.x > left.x && node.x < right.x);
  if (!interior.length) return null;
  return { member, left, right, interior: interior[0] };
}

/** Single horizontal-beam controls use geometry and references, never fixed IDs. */
export function readBeamControls(workspace: StaticsWorkspace): BeamControls | null {
  const parts = beamParts(workspace);
  if (!parts) return null;
  const { left, right, interior } = parts;
  const load = workspace.loads.find((item) => item.kind === 'force' && item.nodeId === interior.id);
  const supportA = workspace.supports.find((item) => item.nodeId === left.id);
  const supportB = workspace.supports.find((item) => item.nodeId === right.id);
  return {
    length: right.x - left.x,
    loadMagnitude: load?.kind === 'force' ? load.magnitude : null,
    loadPosition: interior.x - left.x,
    supportA: supportA?.kind ?? 'none',
    supportB: supportB?.kind ?? 'none',
  };
}

export type BeamChange =
  | { field: 'length' | 'loadMagnitude' | 'loadPosition'; value: number }
  | { field: 'supportA' | 'supportB'; value: SupportSelection };

/** One atomic state update keeps nodes, annotations, loads, and supports consistent. */
export function updateBeamWorkspace(workspace: StaticsWorkspace, change: BeamChange): StaticsWorkspace {
  const current = readBeamControls(workspace);
  if (!current) return workspace;
  const parts = beamParts(workspace)!;
  if (change.field === 'supportA' || change.field === 'supportB') {
    const nodeId = change.field === 'supportA' ? parts.left.id : parts.right.id;
    if (change.value === 'none') {
      return { ...workspace, supports: workspace.supports.filter((support) => support.nodeId !== nodeId) };
    }
    const nextKind: StaticsSupport['kind'] = change.value;
    const existing = workspace.supports.find((support) => support.nodeId === nodeId);
    const reactionAngle = workspace.units.angle === 'rad' ? Math.PI / 2 : 90;
    return {
      ...workspace,
      supports: existing
        ? workspace.supports.map((support) => {
          if (support.nodeId !== nodeId) return support;
          const next = { ...support };
          delete next.reactionAngle;
          return { ...next, kind: nextKind,
            ...(nextKind === 'roller' ? { reactionAngle } : {}) };
        })
        : [...workspace.supports, { id: `support-${nodeId}`, nodeId, kind: nextKind,
          ...(nextKind === 'roller' ? { reactionAngle } : {}) }],
    };
  }
  if (!Number.isFinite(change.value)) return workspace;
  if (change.field === 'loadMagnitude') {
    if (change.value < 0) return workspace;
    return { ...workspace, loads: workspace.loads.map((load) =>
      load.kind === 'force' && load.nodeId === parts.interior.id ? { ...load, magnitude: change.value } : load) };
  }
  if (change.field === 'length' && change.value < 0.1) return workspace;
  if (change.field === 'loadPosition' && (change.value <= 0 || change.value >= current.length)) return workspace;
  const length = change.field === 'length' ? change.value : current.length;
  const position = change.field === 'loadPosition' ? change.value : Math.min(current.loadPosition, length - 0.01);
  const nodes = workspace.nodes.map((node) => node.id === parts.right.id ? { ...node, x: parts.left.x + length }
    : node.id === parts.interior.id ? { ...node, x: parts.left.x + position } : node);
  const dimensions = workspace.dimensions.map((dimension) => {
    const start = nodes.find((node) => node.id === dimension.startNodeId);
    const end = nodes.find((node) => node.id === dimension.endNodeId);
    if (!start || !end) return dimension;
    return { ...dimension, value: Math.hypot(end.x - start.x, end.y - start.y) };
  });
  return { ...workspace, nodes, dimensions };
}

/** The basic editor changes one load; other loads remain available through the workspace schema. */
export function readEditableBeamLoad(workspace: StaticsWorkspace): StaticsLoad | null {
  const parts = beamParts(workspace);
  if (!parts || workspace.loads.length !== 1) return null;
  const load = workspace.loads[0];
  return load.kind === 'distributed' && load.memberId === parts.member.id ||
    load.kind !== 'distributed' && load.nodeId === parts.interior.id ? load : null;
}

export function updateBeamLoadKind(workspace: StaticsWorkspace, kind: StaticsLoad['kind']): StaticsWorkspace {
  const current = readEditableBeamLoad(workspace);
  if (!current || current.kind === kind) return workspace;
  const parts = beamParts(workspace)!;
  const downward = workspace.units.angle === 'rad' ? -Math.PI / 2 : -90;
  const load: StaticsLoad = kind === 'force'
    ? { id: current.id, kind, nodeId: parts.interior.id, magnitude: 10, angle: downward }
    : kind === 'moment'
      ? { id: current.id, kind, nodeId: parts.interior.id, magnitude: 8 }
      : { id: current.id, kind, memberId: parts.member.id, startMagnitude: 2, endMagnitude: 2, angle: downward };
  return { ...workspace, loads: [load] };
}

export type BeamLoadField = 'magnitude' | 'angle' | 'startMagnitude' | 'endMagnitude';

export function updateBeamLoadValue(workspace: StaticsWorkspace, field: BeamLoadField, value: number): StaticsWorkspace {
  const load = readEditableBeamLoad(workspace);
  if (!load || !Number.isFinite(value)) return workspace;
  if (field === 'magnitude' && load.kind !== 'distributed') {
    if (load.kind === 'force' && value < 0) return workspace;
    return { ...workspace, loads: [{ ...load, magnitude: value }] };
  }
  if (field === 'angle' && load.kind !== 'moment') {
    return { ...workspace, loads: [{ ...load, angle: value }] };
  }
  if (load.kind === 'distributed' && (field === 'startMagnitude' || field === 'endMagnitude')) {
    return { ...workspace, loads: [{ ...load, [field]: value }] };
  }
  return workspace;
}

export function updateRollerAngle(workspace: StaticsWorkspace, nodeId: string, value: number): StaticsWorkspace {
  if (!readBeamControls(workspace) || !Number.isFinite(value)) return workspace;
  return { ...workspace, supports: workspace.supports.map((support) =>
    support.nodeId === nodeId && support.kind === 'roller' ? { ...support, reactionAngle: value } : support) };
}
