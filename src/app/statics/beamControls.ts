import type { StaticsLoad, StaticsSupport, StaticsWorkspace } from './model.ts';

type SupportSelection = StaticsSupport['kind'] | 'none';

export interface BeamControls {
  length: number;
  loadMagnitude: number | null;
  loadPosition: number;
  supportA: SupportSelection;
  supportB: SupportSelection;
}

/** Return controls only for the editable A–C–B beam. Values always come from the workspace. */
export function readBeamControls(workspace: StaticsWorkspace): BeamControls | null {
  const a = workspace.nodes.find((node) => node.id === 'A');
  const b = workspace.nodes.find((node) => node.id === 'B');
  const c = workspace.nodes.find((node) => node.id === 'C');
  const member = workspace.members.find((item) => item.startNodeId === 'A' && item.endNodeId === 'B');
  const load = workspace.loads.find((item) => item.kind === 'force' && item.nodeId === 'C');
  const supportA = workspace.supports.find((item) => item.nodeId === 'A');
  const supportB = workspace.supports.find((item) => item.nodeId === 'B');
  if (!a || !b || !c || !member ||
    a.y !== b.y || b.y !== c.y || b.x <= a.x || c.x <= a.x || c.x >= b.x) return null;
  return {
    length: b.x - a.x,
    loadMagnitude: load?.kind === 'force' ? load.magnitude : null,
    loadPosition: c.x - a.x,
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
  if (change.field === 'supportA' || change.field === 'supportB') {
    const nodeId = change.field === 'supportA' ? 'A' : 'B';
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
      load.kind === 'force' && load.nodeId === 'C' ? { ...load, magnitude: change.value } : load) };
  }
  if (change.field === 'length' && change.value < 0.1) return workspace;
  if (change.field === 'loadPosition' && (change.value <= 0 || change.value >= current.length)) return workspace;
  const length = change.field === 'length' ? change.value : current.length;
  const position = change.field === 'loadPosition' ? change.value : Math.min(current.loadPosition, length - 0.01);
  const a = workspace.nodes.find((node) => node.id === 'A')!;
  const nodes = workspace.nodes.map((node) => node.id === 'B' ? { ...node, x: a.x + length }
    : node.id === 'C' ? { ...node, x: a.x + position } : node);
  const dimensions = workspace.dimensions.map((dimension) => {
    const start = nodes.find((node) => node.id === dimension.startNodeId);
    const end = nodes.find((node) => node.id === dimension.endNodeId);
    if (!start || !end || !['A', 'B', 'C'].includes(start.id) || !['A', 'B', 'C'].includes(end.id)) return dimension;
    return { ...dimension, value: Math.hypot(end.x - start.x, end.y - start.y) };
  });
  return { ...workspace, nodes, dimensions };
}

/** The basic editor changes one load; other loads remain available through the workspace schema. */
export function readEditableBeamLoad(workspace: StaticsWorkspace): StaticsLoad | null {
  if (!readBeamControls(workspace) || workspace.loads.length !== 1) return null;
  const load = workspace.loads[0];
  return load.kind === 'distributed' && load.memberId === 'AB' ||
    load.kind !== 'distributed' && load.nodeId === 'C' ? load : null;
}

export function updateBeamLoadKind(workspace: StaticsWorkspace, kind: StaticsLoad['kind']): StaticsWorkspace {
  const current = readEditableBeamLoad(workspace);
  if (!current || current.kind === kind) return workspace;
  const downward = workspace.units.angle === 'rad' ? -Math.PI / 2 : -90;
  const load: StaticsLoad = kind === 'force'
    ? { id: current.id, kind, nodeId: 'C', magnitude: 10, angle: downward }
    : kind === 'moment'
      ? { id: current.id, kind, nodeId: 'C', magnitude: 8 }
      : { id: current.id, kind, memberId: 'AB', startMagnitude: 2, endMagnitude: 2, angle: downward };
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

export function updateRollerAngle(workspace: StaticsWorkspace, nodeId: 'A' | 'B', value: number): StaticsWorkspace {
  if (!readBeamControls(workspace) || !Number.isFinite(value)) return workspace;
  return { ...workspace, supports: workspace.supports.map((support) =>
    support.nodeId === nodeId && support.kind === 'roller' ? { ...support, reactionAngle: value } : support) };
}
