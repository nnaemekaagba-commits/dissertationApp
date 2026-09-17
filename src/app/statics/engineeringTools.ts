import { calculatePlanarBeamReactions, type BeamReactionResult } from './calculations.ts';
import { readBeamControls, updateBeamWorkspace } from './beamControls.ts';
import { parseStaticsWorkspace, type StaticsSupport, type StaticsWorkspace } from './model.ts';

export const ENGINEERING_TOOL_NAMES = [
  'get_current_structure', 'change_load_magnitude', 'move_load', 'change_support',
  'change_dimension', 'show_view', 'show_fbd', 'calculate_reactions',
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
  uiActions: EngineeringUiAction[];
  structureChanged: boolean;
  /** Always derived from the final, validated workspace after all edits. */
  outcome?: { structure: StaticsWorkspace; calculation?: BeamReactionResult; calculationError?: string };
}

const STRUCTURE_MUTATIONS = new Set<EngineeringToolName>([
  'change_load_magnitude', 'move_load', 'change_support', 'change_dimension',
]);

export function executeEngineeringToolBatch(workspace: StaticsWorkspace, calls: EngineeringToolCall[]): EngineeringToolBatch {
  if (!Array.isArray(calls) || calls.length < 1 || calls.length > 8) {
    throw new Error('The chatbot returned an invalid number of engineering tool calls.');
  }
  const seenIds = new Set<string>();
  const results: EngineeringToolResult[] = [];
  const uiActions: EngineeringUiAction[] = [];
  let current = workspace;
  let structureChanged = false;
  for (const call of calls) {
    if (!call || typeof call.id !== 'string' || !call.id || call.id.length > 128 || seenIds.has(call.id) ||
      typeof call.name !== 'string') {
      throw new Error('The chatbot returned an invalid engineering tool call.');
    }
    seenIds.add(call.id);
    try {
      const execution = executeEngineeringTool(current, call);
      current = execution.workspace;
      if (execution.uiAction) uiActions.push(execution.uiAction);
      if (STRUCTURE_MUTATIONS.has(call.name as EngineeringToolName)) structureChanged = true;
      results.push({ id: call.id, name: call.name, success: true, result: execution.result });
    } catch (error) {
      results.push({ id: call.id, name: call.name, success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed.' });
    }
  }
  if (!structureChanged) return { workspace: current, results, uiActions, structureChanged };
  const outcome: NonNullable<EngineeringToolBatch['outcome']> = { structure: current };
  try {
    outcome.calculation = calculatePlanarBeamReactions(current);
  } catch (error) {
    outcome.calculationError = error instanceof Error ? error.message : 'The solver could not calculate reactions.';
  }
  return { workspace: current, results, uiActions, structureChanged, outcome };
}

/** Build the post-edit reply entirely from executed tools and the deterministic solver. */
export function formatEngineeringToolBatch(batch: EngineeringToolBatch): string {
  const lines: string[] = [];
  for (const item of batch.results) {
    if (!item.success) {
      lines.push(`- ${item.name}: ${item.error}`);
      continue;
    }
    const result = item.result || {};
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
    if (item.name === 'show_view') lines.push(`- Showing the ${result.view} view.`);
    if (item.name === 'show_fbd') lines.push(`- Free-body diagram ${result.fbdVisible ? 'shown' : 'hidden'}.`);
  }
  const calculation = batch.outcome?.calculation || (batch.results.find((item) =>
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
  } else if (batch.outcome?.calculationError) {
    lines.push('', `Reactions could not be calculated: ${batch.outcome.calculationError}`);
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
    const { left, right } = findBeam(workspace);
    const node = workspace.nodes.find((item) => item.id === nodeId);
    if (!node || node.y !== left.y || node.x < left.x || node.x > right.x) throw new Error('Support node must lie on the beam.');
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
  if (name === 'change_dimension') {
    const args = object(raw, ['dimensionId', 'value']);
    const dimensionId = text(args.dimensionId, 'dimensionId');
    const value = finite(args.value, 'value');
    if (value <= 0) throw new Error('Dimension value must be positive.');
    const dimension = workspace.dimensions.find((item) => item.id === dimensionId);
    if (!dimension) throw new Error(`Dimension ${dimensionId} does not exist.`);
    const beam = readBeamControls(workspace);
    if (!beam) throw new Error('This dimension can only be changed on the editable A-C-B beam.');
    let next: StaticsWorkspace;
    if (new Set([dimension.startNodeId, dimension.endNodeId]).has('A') &&
      new Set([dimension.startNodeId, dimension.endNodeId]).has('B')) {
      next = updateBeamWorkspace(workspace, { field: 'length', value });
    } else if (new Set([dimension.startNodeId, dimension.endNodeId]).has('A') &&
      new Set([dimension.startNodeId, dimension.endNodeId]).has('C')) {
      next = updateBeamWorkspace(workspace, { field: 'loadPosition', value });
    } else if (new Set([dimension.startNodeId, dimension.endNodeId]).has('C') &&
      new Set([dimension.startNodeId, dimension.endNodeId]).has('B')) {
      next = updateBeamWorkspace(workspace, { field: 'loadPosition', value: beam.length - value });
    } else throw new Error('This dimension cannot be mapped to beam geometry.');
    if (next === workspace) throw new Error('Dimension value is outside the valid beam range.');
    return { workspace: parseStaticsWorkspace(next), result: { dimensionId, value, lengthUnit: workspace.units.length } };
  }
  throw new Error('Unknown engineering tool.');
}
