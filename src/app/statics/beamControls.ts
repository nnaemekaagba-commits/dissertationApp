import type { StaticsSupport, StaticsWorkspace } from './model.ts';

export interface BeamControls {
  length: number;
  loadMagnitude: number;
  loadPosition: number;
  supportA: StaticsSupport['kind'];
  supportB: StaticsSupport['kind'];
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
  if (!a || !b || !c || !member || !load || load.kind !== 'force' || !supportA || !supportB ||
    a.y !== b.y || b.y !== c.y || b.x <= a.x || c.x <= a.x || c.x >= b.x) return null;
  return {
    length: b.x - a.x,
    loadMagnitude: load.magnitude,
    loadPosition: c.x - a.x,
    supportA: supportA.kind,
    supportB: supportB.kind,
  };
}

export type BeamChange =
  | { field: 'length' | 'loadMagnitude' | 'loadPosition'; value: number }
  | { field: 'supportA' | 'supportB'; value: StaticsSupport['kind'] };

/** One atomic state update keeps nodes, annotations, loads, and supports consistent. */
export function updateBeamWorkspace(workspace: StaticsWorkspace, change: BeamChange): StaticsWorkspace {
  const current = readBeamControls(workspace);
  if (!current) return workspace;
  if (change.field === 'supportA' || change.field === 'supportB') {
    const nodeId = change.field === 'supportA' ? 'A' : 'B';
    return {
      ...workspace,
      supports: workspace.supports.map((support) => {
        if (support.nodeId !== nodeId) return support;
        const next = { ...support };
        delete next.reactionAngle;
        return { ...next, kind: change.value,
          ...(change.value === 'roller' ? { reactionAngle: 90 } : {}) };
      }),
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
