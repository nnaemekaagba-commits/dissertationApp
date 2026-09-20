import { calculatePlanarBeamReactions, type BeamReactionResult } from './calculations.ts';
import { explicitlyRequestsCalculation } from './calculationPolicy.ts';
import { readBeamControls, updateBeamWorkspace } from './beamControls.ts';
import { parseStaticsWorkspace, type StaticsSupport, type StaticsWorkspace } from './model.ts';

export const ENGINEERING_TOOL_NAMES = [
  'get_current_structure', 'create_structure', 'add_node', 'remove_node', 'add_member', 'remove_member',
  'change_load_magnitude', 'move_load', 'change_support',
  'change_member_dimension', 'add_load', 'remove_load', 'change_dimension',
  'show_view', 'show_fbd', 'calculate_reactions',
] as const;
export type EngineeringToolName = typeof ENGINEERING_TOOL_NAMES[number];
export type EngineeringView = 'front' | 'top' | 'right' | 'isometric' | 'free' | 'reset';
export type EngineeringUiAction = { kind: 'view'; view: EngineeringView } | { kind: 'fbd'; visible: boolean };

export interface EngineeringToolCall { id: string; name: string; arguments: unknown }
export interface EngineeringToolExecution {
  workspace: StaticsWorkspace;
  result: Record<string, unknown>;
  uiAction?: EngineeringUiAction;
}

export interface EngineeringToolResult {
  id: string;
  name: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export interface EngineeringToolBatch {
  workspace: StaticsWorkspace;
  results: EngineeringToolResult[];
  interactions: Array<{ call: EngineeringToolCall; result: EngineeringToolResult;
    before: StaticsWorkspace; after: StaticsWorkspace;
    calculation?: BeamReactionResult; calculationError?: string }>;
  uiActions: EngineeringUiAction[];
  structureChanged: boolean;
  /** Always derived from the final, validated workspace after all edits. */
  outcome?: { structure: StaticsWorkspace; calculation?: BeamReactionResult; calculationError?: string };
}

const STRUCTURE_MUTATIONS = new Set<EngineeringToolName>([
  'create_structure', 'add_node', 'remove_node', 'add_member', 'remove_member',
  'change_load_magnitude', 'move_load', 'change_support', 'change_member_dimension',
  'change_dimension', 'add_load', 'remove_load',
]);

export function executeEngineeringToolBatch(workspace: StaticsWorkspace, calls: EngineeringToolCall[],
  onWorkspaceChange?: (next: StaticsWorkspace) => void, studentMessage?: string): EngineeringToolBatch {
  if (!Array.isArray(calls) || calls.length < 1 || calls.length > 8) {
    throw new Error('The chatbot returned an invalid number of engineering tool calls.');
  }
  const seenIds = new Set<string>();
  const results: EngineeringToolResult[] = [];
  const interactions: EngineeringToolBatch['interactions'] = [];
  const uiActions: EngineeringUiAction[] = [];
  let current = workspace;
  let structureChanged = false;
  for (const call of calls) {
    if (!call || typeof call.id !== 'string' || !call.id || call.id.length > 128 || seenIds.has(call.id) ||
      typeof call.name !== 'string') {
      throw new Error('The chatbot returned an invalid engineering tool call.');
    }
    seenIds.add(call.id);
    const before = current;
    try {
      if (call.name === 'calculate_reactions' && studentMessage !== undefined &&
        !explicitlyRequestsCalculation(studentMessage))
        throw new Error('Reaction calculation requires an explicit student request.');
      const execution = executeEngineeringTool(current, call);
      if (STRUCTURE_MUTATIONS.has(call.name as EngineeringToolName) && execution.workspace !== current) {
        onWorkspaceChange?.(execution.workspace);
      }
      current = execution.workspace;
      if (execution.uiAction) uiActions.push(execution.uiAction);
      if (STRUCTURE_MUTATIONS.has(call.name as EngineeringToolName)) structureChanged = true;
      const result = { id: call.id, name: call.name, success: true, result: execution.result };
      results.push(result);
      const interaction: EngineeringToolBatch['interactions'][number] = { call, result, before, after: current };
      if (call.name === 'calculate_reactions') {
        interaction.calculation = execution.result.calculation as BeamReactionResult;
      }
      interactions.push(interaction);
    } catch (error) {
      const result = { id: call.id, name: call.name, success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed.' };
      results.push(result);
      interactions.push({ call, result, before, after: current });
    }
  }
  if (!structureChanged) return { workspace: current, results, interactions, uiActions, structureChanged };
  return { workspace: current, results, interactions, uiActions, structureChanged,
    outcome: { structure: current } };
}

/** Numerical reactions appear only for an explicitly executed calculate_reactions tool. */
export function formatEngineeringToolBatch(batch: EngineeringToolBatch): string {
  const lines: string[] = [];
  for (const item of batch.results) {
    if (!item.success) {
      lines.push(`- ${item.name}: ${item.error}`);
      continue;
    }
    const result = item.result || {};
    if (item.name === 'get_current_structure') {
      const structure = result.structure as StaticsWorkspace;
      const count = (value: number, label: string) => `${value} ${label}${value === 1 ? '' : 's'}`;
      lines.push(`- Current structure: ${count(structure.nodes.length, 'node')}, ${count(structure.members.length, 'member')}, ` +
        `${count(structure.supports.length, 'support')}, ${count(structure.loads.length, 'load')}; units: ` +
        `${structure.units.length} and ${structure.units.force}.`);
    }
    if (item.name === 'create_structure') lines.push(`- Created a structure with ${result.nodeCount} joints and ${result.memberCount} members.`);
    if (item.name === 'add_node') lines.push(`- Added joint ${result.nodeId}.`);
    if (item.name === 'remove_node') lines.push(`- Removed joint ${result.nodeId}.`);
    if (item.name === 'add_member') lines.push(`- Added member ${result.memberId}.`);
    if (item.name === 'remove_member') lines.push(`- Removed member ${result.memberId}.`);
    if (item.name === 'change_load_magnitude') {
      const load = batch.workspace.loads.find((candidate) => candidate.id === result.loadId);
      const unit = load?.kind === 'moment' ? (batch.workspace.units.moment || `${batch.workspace.units.force}*${batch.workspace.units.length}`)
        : load?.kind === 'distributed' ? `${batch.workspace.units.force}/${batch.workspace.units.length}`
          : batch.workspace.units.force;
      lines.push(`- Changed load ${result.loadId} magnitude to ${result.magnitude} ${unit}.`);
    }
    if (item.name === 'move_load') lines.push(`- Moved load ${result.loadId} to ${result.position} ${result.lengthUnit} from the left end.`);
    if (item.name === 'change_support') lines.push(`- Changed support at ${result.nodeId} to ${result.kind}.`);
    if (item.name === 'change_dimension') lines.push(`- Changed dimension ${result.dimensionId} to ${result.value} ${result.lengthUnit}.`);
    if (item.name === 'change_member_dimension') lines.push(`- Changed member ${result.memberId} length to ${result.value} ${result.lengthUnit}.`);
    if (item.name === 'add_load') lines.push(`- Added ${result.kind} load ${result.loadId}.`);
    if (item.name === 'remove_load') lines.push(`- Removed load ${result.loadId}.`);
    if (item.name === 'show_view') lines.push(`- Showing the ${result.view} view.`);
    if (item.name === 'show_fbd') lines.push(`- Free-body diagram ${result.fbdVisible ? 'shown' : 'hidden'}.`);
  }
  const calculation = (batch.results.find((item) =>
    item.success && item.name === 'calculate_reactions')?.result?.calculation as BeamReactionResult | undefined);
  if (calculation) {
    const number = (value: number) => Number(value.toPrecision(8)).toString();
    lines.push('', 'Support reactions (equilibrium solver):');
    for (const reaction of calculation.reactions) {
      const components = [`Fx = ${number(reaction.horizontal)} ${calculation.forceUnit}`,
        `Fy = ${number(reaction.vertical)} ${calculation.forceUnit}`];
      if (reaction.kind === 'fixed') components.push(`M = ${number(reaction.moment)} ${calculation.momentUnit}`);
      lines.push(`- ${reaction.nodeId}: ${components.join(', ')}.`);
    }
  }
  return lines.join('\n') || 'No engineering change was made.';
}

const object = (value: unknown, required: string[], optional: string[] = []): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be an object.');
  const row = value as Record<string, unknown>;
  if (required.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new Error(`Tool arguments must contain only: ${[...required, ...optional].join(', ') || '(no fields)'}.`);
  }
  return row;
};
const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error(`${name} must be a nonempty string.`);
  return value;
};
const finite = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
};
const choice = <T extends string>(value: unknown, values: readonly T[], name: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`${name} must be one of ${values.join(', ')}.`);
  return value as T;
};
const findBeam = (workspace: StaticsWorkspace) => {
  if (workspace.members.length !== 1) throw new Error('This operation requires one beam member.');
  const member = workspace.members[0];
  const start = workspace.nodes.find((node) => node.id === member.startNodeId)!;
  const end = workspace.nodes.find((node) => node.id === member.endNodeId)!;
  if (start.y !== end.y || start.x === end.x) throw new Error('This operation requires a horizontal beam.');
  return { member, left: start.x < end.x ? start : end, right: start.x < end.x ? end : start };
};
const withMovedNode = (workspace: StaticsWorkspace, nodeId: string, x: number): StaticsWorkspace => {
  const nodes = workspace.nodes.map((node) => node.id === nodeId ? { ...node, x } : node);
  const dimensions = workspace.dimensions.map((dimension) => {
    if (dimension.startNodeId !== nodeId && dimension.endNodeId !== nodeId) return dimension;
    const start = nodes.find((node) => node.id === dimension.startNodeId)!;
    const end = nodes.find((node) => node.id === dimension.endNodeId)!;
    return { ...dimension, value: Math.hypot(end.x - start.x, end.y - start.y) };
  });
  return parseStaticsWorkspace({ ...workspace, nodes, dimensions });
};

/** This is the only place model-suggested tool arguments may change engineering state. */
export function executeEngineeringTool(workspace: StaticsWorkspace, call: EngineeringToolCall): EngineeringToolExecution {
  const name = choice(call.name, ENGINEERING_TOOL_NAMES, 'tool name');
  let raw = call.arguments;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { throw new Error('Tool arguments are not valid JSON.'); }
  }
  if (name === 'get_current_structure') {
    object(raw, []);
    return { workspace, result: { structure: workspace } };
  }
  if (name === 'create_structure') {
    const args = object(raw, ['nodes', 'members']);
    if (!Array.isArray(args.nodes) || !Array.isArray(args.members))
      throw new Error('nodes and members must be arrays.');
    const nodes = args.nodes.map((entry) => {
      const row = object(entry, ['id', 'x', 'y']);
      return { id: text(row.id, 'node id'), x: finite(row.x, 'node x'), y: finite(row.y, 'node y') };
    });
    const members = args.members.map((entry) => {
      const row = object(entry, ['id', 'startNodeId', 'endNodeId']);
      return { id: text(row.id, 'member id'), startNodeId: text(row.startNodeId, 'startNodeId'),
        endNodeId: text(row.endNodeId, 'endNodeId') };
    });
    if (!nodes.length) throw new Error('A structure needs at least one joint.');
    const next = parseStaticsWorkspace({ nodes, members, supports: [], loads: [], dimensions: [],
      units: workspace.units });
    return { workspace: next, result: { nodeCount: nodes.length, memberCount: members.length } };
  }
  if (name === 'add_node') {
    const args = object(raw, ['id', 'x', 'y']);
    const node = { id: text(args.id, 'node id'), x: finite(args.x, 'x'), y: finite(args.y, 'y') };
    const next = parseStaticsWorkspace({ ...workspace, nodes: [...workspace.nodes, node] });
    return { workspace: next, result: { nodeId: node.id } };
  }
  if (name === 'remove_node') {
    const args = object(raw, ['id']);
    const nodeId = text(args.id, 'node id');
    if (!workspace.nodes.some((node) => node.id === nodeId)) throw new Error(`Joint ${nodeId} does not exist.`);
    if (workspace.members.some((member) => member.startNodeId === nodeId || member.endNodeId === nodeId) ||
      workspace.supports.some((support) => support.nodeId === nodeId) ||
      workspace.loads.some((load) => load.kind !== 'distributed' && load.nodeId === nodeId) ||
      workspace.dimensions.some((item) => item.startNodeId === nodeId || item.endNodeId === nodeId) ||
      workspace.angles?.some((item) => [item.vertexNodeId, item.fromNodeId, item.toNodeId].includes(nodeId)))
      throw new Error(`Joint ${nodeId} is still referenced; remove connected elements first.`);
    const next = parseStaticsWorkspace({ ...workspace,
      nodes: workspace.nodes.filter((node) => node.id !== nodeId) });
    return { workspace: next, result: { nodeId } };
  }
  if (name === 'add_member') {
    const args = object(raw, ['id', 'startNodeId', 'endNodeId']);
    const member = { id: text(args.id, 'member id'),
      startNodeId: text(args.startNodeId, 'startNodeId'), endNodeId: text(args.endNodeId, 'endNodeId') };
    const next = parseStaticsWorkspace({ ...workspace, members: [...workspace.members, member] });
    return { workspace: next, result: { memberId: member.id } };
  }
  if (name === 'remove_member') {
    const args = object(raw, ['id']);
    const memberId = text(args.id, 'member id');
    if (!workspace.members.some((member) => member.id === memberId))
      throw new Error(`Member ${memberId} does not exist.`);
    if (workspace.loads.some((load) => load.kind === 'distributed' && load.memberId === memberId))
      throw new Error(`Member ${memberId} has a distributed load; remove that load first.`);
    const next = parseStaticsWorkspace({ ...workspace,
      members: workspace.members.filter((member) => member.id !== memberId) });
    return { workspace: next, result: { memberId } };
  }
  if (name === 'calculate_reactions') {
    object(raw, []);
    return { workspace, result: { calculation: calculatePlanarBeamReactions(workspace) } };
  }
  if (name === 'show_view') {
    const args = object(raw, ['view']);
    const view = choice(args.view, ['front', 'top', 'right', 'isometric', 'free', 'reset'] as const, 'view');
    return { workspace, result: { view }, uiAction: { kind: 'view', view } };
  }
  if (name === 'show_fbd') {
    const args = object(raw, ['visible']);
    if (typeof args.visible !== 'boolean') throw new Error('visible must be a boolean.');
    return { workspace, result: { fbdVisible: args.visible }, uiAction: { kind: 'fbd', visible: args.visible } };
  }
  if (name === 'change_load_magnitude') {
    const args = object(raw, ['loadId', 'magnitude']);
    const loadId = text(args.loadId, 'loadId');
    const magnitude = finite(args.magnitude, 'magnitude');
    const load = workspace.loads.find((item) => item.id === loadId);
    if (!load) throw new Error(`Load ${loadId} does not exist.`);
    if (load.kind !== 'moment' && magnitude < 0) throw new Error('Force magnitude must be nonnegative.');
    const loads = workspace.loads.map((item) => item.id !== loadId ? item
      : item.kind === 'distributed' ? { ...item, startMagnitude: magnitude, endMagnitude: magnitude }
        : { ...item, magnitude });
    const next = parseStaticsWorkspace({ ...workspace, loads });
    return { workspace: next, result: { loadId, magnitude, loadKind: load.kind } };
  }
  if (name === 'move_load') {
    const args = object(raw, ['loadId', 'position']);
    const loadId = text(args.loadId, 'loadId');
    const position = finite(args.position, 'position');
    const load = workspace.loads.find((item) => item.id === loadId);
    if (!load || load.kind === 'distributed') throw new Error('move_load requires an existing point force or applied moment.');
    const { left, right } = findBeam(workspace);
    const node = workspace.nodes.find((item) => item.id === load.nodeId)!;
    if (node.id === left.id || node.id === right.id || workspace.supports.some((item) => item.nodeId === node.id) ||
      workspace.loads.some((item) => item.id !== loadId && item.kind !== 'distributed' && item.nodeId === node.id)) {
      throw new Error('The load must use its own movable interior node.');
    }
    if (position <= 0 || position >= right.x - left.x) throw new Error('position must be strictly inside the beam.');
    const next = withMovedNode(workspace, node.id, left.x + position);
    return { workspace: next, result: { loadId, position, lengthUnit: workspace.units.length } };
  }
  if (name === 'change_support') {
    const args = object(raw, ['nodeId', 'kind'], ['reactionAngle']);
    const nodeId = text(args.nodeId, 'nodeId');
    const kind = choice(args.kind, ['none', 'pin', 'roller', 'fixed'] as const, 'kind');
    const node = workspace.nodes.find((item) => item.id === nodeId);
    if (!node) throw new Error(`Support node ${nodeId} does not exist.`);
    if (kind !== 'roller' && args.reactionAngle !== undefined) throw new Error('reactionAngle applies only to a roller.');
    const angle = args.reactionAngle === undefined ? (workspace.units.angle === 'rad' ? Math.PI / 2 : 90)
      : finite(args.reactionAngle, 'reactionAngle');
    const existing = workspace.supports.find((item) => item.nodeId === nodeId);
    const supports: StaticsSupport[] = kind === 'none'
      ? workspace.supports.filter((item) => item.nodeId !== nodeId)
      : existing
        ? workspace.supports.map((item) => item.nodeId !== nodeId ? item : {
          id: item.id, nodeId, kind, ...(kind === 'roller' ? { reactionAngle: angle } : {}),
        })
        : [...workspace.supports, { id: `support-${nodeId}`, nodeId, kind,
          ...(kind === 'roller' ? { reactionAngle: angle } : {}) }];
    const next = parseStaticsWorkspace({ ...workspace, supports });
    return { workspace: next, result: { nodeId, kind, ...(kind === 'roller' ? { reactionAngle: angle } : {}) } };
  }
  if (name === 'change_member_dimension') {
    const args = object(raw, ['memberId', 'value']);
    const memberId = text(args.memberId, 'memberId');
    const value = finite(args.value, 'value');
    if (value <= 0) throw new Error('Member length must be positive.');
    const beam = readBeamControls(workspace);
    if (!beam || workspace.members.length !== 1 || workspace.members[0].id !== memberId) {
      throw new Error('Member is not the editable horizontal beam.');
    }
    const next = updateBeamWorkspace(workspace, { field: 'length', value });
    if (next === workspace) throw new Error('Member length is outside the valid range.');
    const validated = parseStaticsWorkspace(next);
    const { left, right } = findBeam(validated);
    for (const load of validated.loads) {
      if (load.kind === 'distributed') continue;
      const point = validated.nodes.find((node) => node.id === load.nodeId)!;
      if (point.x < left.x || point.x > right.x) {
        throw new Error(`Load ${load.id} would lie outside the resized beam.`);
      }
    }
    for (const support of validated.supports) {
      const point = validated.nodes.find((node) => node.id === support.nodeId)!;
      if (point.x < left.x || point.x > right.x) {
        throw new Error(`Support ${support.id} would lie outside the resized beam.`);
      }
    }
    return { workspace: validated, result: { memberId, value, lengthUnit: workspace.units.length } };
  }
  if (name === 'add_load') {
    const args = object(raw, ['loadId', 'kind', 'magnitude'], ['position', 'angle']);
    const loadId = text(args.loadId, 'loadId');
    const kind = choice(args.kind, ['force', 'moment', 'distributed'] as const, 'kind');
    const magnitude = finite(args.magnitude, 'magnitude');
    if (kind !== 'moment' && magnitude < 0) throw new Error('Force magnitude must be nonnegative.');
    if (workspace.loads.some((load) => load.id === loadId)) throw new Error(`Load ${loadId} already exists.`);
    const beam = findBeam(workspace);
    if (kind === 'distributed') {
      if (args.position !== undefined) throw new Error('Distributed loads cannot have a point position.');
      const angle = args.angle === undefined ? (workspace.units.angle === 'rad' ? -Math.PI / 2 : -90)
        : finite(args.angle, 'angle');
      const next = parseStaticsWorkspace({ ...workspace, loads: [...workspace.loads,
        { id: loadId, kind, memberId: beam.member.id, startMagnitude: magnitude, endMagnitude: magnitude, angle }] });
      return { workspace: next, result: { loadId, kind, magnitude } };
    }
    if (args.position === undefined) throw new Error('Point load position is required.');
    const position = finite(args.position, 'position');
    if (position <= 0 || position >= beam.right.x - beam.left.x) {
      throw new Error('position must be strictly inside the beam.');
    }
    if (kind === 'moment' && args.angle !== undefined) throw new Error('Applied moments cannot have a force angle.');
    const nodeId = `load-node-${loadId}`;
    if (workspace.nodes.some((node) => node.id === nodeId)) throw new Error(`Node ${nodeId} already exists.`);
    const node = { id: nodeId, x: beam.left.x + position, y: beam.left.y };
    const load = kind === 'force'
      ? { id: loadId, kind, nodeId, magnitude, angle: args.angle === undefined
        ? (workspace.units.angle === 'rad' ? -Math.PI / 2 : -90) : finite(args.angle, 'angle') }
      : { id: loadId, kind, nodeId, magnitude };
    const next = parseStaticsWorkspace({ ...workspace, nodes: [...workspace.nodes, node],
      loads: [...workspace.loads, load] });
    return { workspace: next, result: { loadId, kind, magnitude, position, lengthUnit: workspace.units.length } };
  }
  if (name === 'remove_load') {
    const args = object(raw, ['loadId']);
    const loadId = text(args.loadId, 'loadId');
    const load = workspace.loads.find((item) => item.id === loadId);
    if (!load) throw new Error(`Load ${loadId} does not exist.`);
    const loads = workspace.loads.filter((item) => item.id !== loadId);
    const orphanNodeId = load.kind === 'distributed' ? null : load.nodeId;
    const keepNode = orphanNodeId && (workspace.members.some((member) =>
      member.startNodeId === orphanNodeId || member.endNodeId === orphanNodeId) ||
      workspace.supports.some((support) => support.nodeId === orphanNodeId) ||
      loads.some((other) => other.kind !== 'distributed' && other.nodeId === orphanNodeId) ||
      workspace.dimensions.some((dimension) => dimension.startNodeId === orphanNodeId || dimension.endNodeId === orphanNodeId) ||
      workspace.angles?.some((angle) => [angle.vertexNodeId, angle.fromNodeId, angle.toNodeId].includes(orphanNodeId)));
    const nodes = orphanNodeId && !keepNode ? workspace.nodes.filter((node) => node.id !== orphanNodeId) : workspace.nodes;
    return { workspace: parseStaticsWorkspace({ ...workspace, loads, nodes }), result: { loadId, kind: load.kind } };
  }
  if (name === 'change_dimension') {
    const args = object(raw, ['dimensionId', 'value']);
    const dimensionId = text(args.dimensionId, 'dimensionId');
    const value = finite(args.value, 'value');
    if (value <= 0) throw new Error('Dimension value must be positive.');
    const dimension = workspace.dimensions.find((item) => item.id === dimensionId);
    if (!dimension) throw new Error(`Dimension ${dimensionId} does not exist.`);
    const beam = readBeamControls(workspace);
    if (!beam) throw new Error('This dimension requires a single horizontal beam with one interior node.');
    const { left, right } = findBeam(workspace);
    const interior = workspace.nodes.find((node) => node.id !== left.id && node.id !== right.id &&
      node.y === left.y && node.x > left.x && node.x < right.x);
    if (!interior) throw new Error('The beam has no interior dimension node.');
    const endpoints = new Set([dimension.startNodeId, dimension.endNodeId]);
    let next: StaticsWorkspace;
    if (endpoints.has(left.id) && endpoints.has(right.id)) {
      next = updateBeamWorkspace(workspace, { field: 'length', value });
    } else if (endpoints.has(left.id) && endpoints.has(interior.id)) {
      next = updateBeamWorkspace(workspace, { field: 'loadPosition', value });
    } else if (endpoints.has(interior.id) && endpoints.has(right.id)) {
      next = updateBeamWorkspace(workspace, { field: 'loadPosition', value: beam.length - value });
    } else throw new Error('This dimension cannot be mapped to beam geometry.');
    if (next === workspace) throw new Error('Dimension value is outside the valid beam range.');
    return { workspace: parseStaticsWorkspace(next), result: { dimensionId, value, lengthUnit: workspace.units.length } };
  }
  throw new Error('Unknown engineering tool.');
}
