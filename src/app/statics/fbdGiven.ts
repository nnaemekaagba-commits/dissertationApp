import type { StaticsMember, StaticsNode, StaticsWorkspace } from './model.ts';
import type { FBDState } from './fbdState.ts';

export const GIVEN_TOGGLES = [
  { key: 'loads', label: 'Show Given Loads' },
  { key: 'dimensions', label: 'Show Given Dimensions' },
  { key: 'angles', label: 'Show Given Angles' },
  { key: 'labels', label: 'Show Labels' },
] as const;
export type GivenToggle = typeof GIVEN_TOGGLES[number]['key'];
export type GivenVisibility = Record<GivenToggle, boolean>;
export const DEFAULT_GIVEN_VISIBILITY: GivenVisibility = {
  loads: true, dimensions: true, angles: true, labels: true,
};

function liesOnMember(node: StaticsNode, member: StaticsMember, nodes: Map<string, StaticsNode>): boolean {
  const start = nodes.get(member.startNodeId);
  const end = nodes.get(member.endNodeId);
  if (!start || !end) return false;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return false;
  const px = node.x - start.x;
  const py = node.y - start.y;
  const cross = px * dy - py * dx;
  const dot = px * dx + py * dy;
  return Math.abs(cross) <= 1e-6 * Math.max(1, lengthSquared) &&
    dot >= -1e-6 && dot <= lengthSquared + 1e-6;
}

/** Selects stated problem data relevant to the isolated object; never derives reactions. */
export function selectGivenFBDInformation(workspace: StaticsWorkspace, state: FBDState,
  visibility: GivenVisibility) {
  const target = state.selectedTarget;
  const nodes = new Map(workspace.nodes.map((node) => [node.id, node]));
  const members = target?.kind === 'body' ? workspace.members :
    target?.kind === 'member' ? workspace.members.filter((member) => member.id === target.id) : [];
  const relevantNodes = !target ? [] : target.kind === 'body' ? workspace.nodes :
    target.kind === 'joint' ? workspace.nodes.filter((node) => node.id === target.id) :
      workspace.nodes.filter((node) => members.some((member) => liesOnMember(node, member, nodes)));
  const nodeIds = new Set(relevantNodes.map((node) => node.id));
  const memberIds = new Set(members.map((member) => member.id));
  return {
    loads: visibility.loads ? workspace.loads.filter((load) => load.kind === 'distributed'
      ? memberIds.has(load.memberId) : nodeIds.has(load.nodeId)) : [],
    dimensions: visibility.dimensions ? workspace.dimensions.filter((dimension) =>
      nodeIds.has(dimension.startNodeId) && nodeIds.has(dimension.endNodeId)) : [],
    angles: visibility.angles ? (workspace.angles || []).filter((angle) =>
      nodeIds.has(angle.vertexNodeId)) : [],
    nodes: visibility.labels ? relevantNodes : [],
    members: visibility.labels ? members : [],
  };
}
