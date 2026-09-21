import type { StaticsWorkspace } from './model.ts';
import { addFBDAngle, addFBDDimension, addFBDForce, addFBDLabel, addFBDMoment,
  addFBDBody, addFBDJoint, addFBDMember, editFBDPrimitive, fbdMemberEndFromAngle,
  deleteFBDElement, editFBDAngle, editFBDDimension, editFBDForce, editFBDLabel,
  editFBDMoment, getFBDElement, repositionFBDLabel, selectFBDTarget,
  type FBDBody, type FBDJoint, type FBDMember, type FBDPrimitiveKind,
  type FBDElementKind, type FBDState } from './fbdState.ts';

export const FBD_CHAT_TOOL_NAMES = [
  'fbd_add_body', 'fbd_add_joint', 'fbd_add_member',
  'fbd_edit_body', 'fbd_edit_joint', 'fbd_edit_member', 'fbd_move_primitive',
  'fbd_add_force', 'fbd_add_moment', 'fbd_add_dimension', 'fbd_add_angle', 'fbd_add_label',
  'fbd_edit_force', 'fbd_edit_moment', 'fbd_edit_dimension', 'fbd_edit_angle', 'fbd_edit_label',
  'fbd_remove_element', 'fbd_move_label', 'fbd_select_object',
] as const;
export type FBDChatToolName = typeof FBD_CHAT_TOOL_NAMES[number];
export type FBDChatToolCall = { id: string; name: string; arguments: unknown };
export type FBDChatToolResult = { id: string; name: string; success: boolean; result?: string; error?: string };
export type FBDChatInteraction = { call: FBDChatToolCall; result: FBDChatToolResult;
  before: FBDState; after: FBDState };
export type FBDChatBatch = { state: FBDState; results: FBDChatToolResult[]; interactions: FBDChatInteraction[] };

/** Advice and questions never authorize an FBD mutation. */
export function explicitlyRequestsFBDModification(message: string): boolean {
  const text = message.trim();
  if (/^(what|why|how|explain|describe|teach|am i|should i|is there|do i|can i)\b/i.test(text)) return false;
  return /\b(add|draw|place|insert|remove|delete|erase|edit|change|move|reposition|rename|replace|select|isolate|set)\b/i.test(text) &&
    /\b(fbd|free[ -]?body|diagram|body|point|line|arrow|annotation|force label|moment label|my force|my moment|my label)\b/i.test(text);
}

function args(value: unknown, allowed: string[], required: string[] = []): Record<string, unknown> {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('Tool arguments must be valid JSON.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be an object.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !allowed.includes(key)) || required.some((key) => row[key] === undefined))
    throw new Error('Unknown or missing FBD tool parameter.');
  return row;
}
const str = (row: Record<string, unknown>, key: string, max = 120): string => {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${key}.`);
  return value.trim();
};
const num = (row: Record<string, unknown>, key: string): number => {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${key}.`);
  return value;
};
const bool = (row: Record<string, unknown>, key: string): boolean => {
  if (typeof row[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
  return row[key] as boolean;
};
const patch = (row: Record<string, unknown>, id: string) => {
  if (!Object.keys(row).some((key) => key !== id)) throw new Error('Specify a property to change.');
};

function applyFBDChatTool(state: FBDState, workspace: StaticsWorkspace, call: FBDChatToolCall,
  newId: () => string): FBDState {
  const name = call.name;
  const value = call.arguments;
  if (/^fbd_(add|edit)_(body|joint|member)$/.test(name)) {
    const [, operation, kind] = /^fbd_(add|edit)_(body|joint|member)$/.exec(name)!;
    const editing = operation === 'edit';
    const geometry = kind === 'body' ? ['x', 'y', 'width', 'height', 'angle'] :
      kind === 'joint' ? ['x', 'y', 'jointKind'] : ['startX', 'startY', 'endX', 'endY', 'angle', 'length'];
    const row = args(value, [...(editing ? ['id'] : []), ...geometry, 'label'],
      editing ? ['id'] : kind === 'joint' ? ['x', 'y'] : kind === 'body' ? ['x', 'y', 'width', 'height'] : ['startX', 'startY']);
    const id = editing ? str(row, 'id', 128) : newId();
    const old = editing ? getFBDElement(state, kind as FBDPrimitiveKind, id) : undefined;
    if (editing && !old) throw new Error(`Unknown FBD ${kind}.`);
    if (editing) patch(row, 'id');
    const coordinate = (key: string, fallback: number) => row[key] === undefined ? fallback : num(row, key);
    const label = row.label === undefined ? old && 'label' in old ? old.label : undefined : str(row, 'label');
    const withLabel = label ? { label } : {};
    const item = kind === 'body' ? { id, origin: {
      x: coordinate('x', (old as FBDBody | undefined)?.origin.x ?? 0),
      y: coordinate('y', (old as FBDBody | undefined)?.origin.y ?? 0) },
      width: coordinate('width', (old as FBDBody | undefined)?.width ?? 0),
      height: coordinate('height', (old as FBDBody | undefined)?.height ?? 0),
      angle: coordinate('angle', (old as FBDBody | undefined)?.angle ?? 0), ...withLabel } :
      kind === 'joint' ? { id, at: {
        x: coordinate('x', (old as FBDJoint | undefined)?.at.x ?? 0),
        y: coordinate('y', (old as FBDJoint | undefined)?.at.y ?? 0) },
        kind: row.jointKind === undefined ? (old as FBDJoint | undefined)?.kind || 'free'
          : str(row, 'jointKind') as FBDJoint['kind'], ...withLabel } :
        (() => {
          const previous = old as FBDMember | undefined;
          const start = { x: coordinate('startX', previous?.start.x ?? 0),
            y: coordinate('startY', previous?.start.y ?? 0) };
          const oldLength = previous ? Math.hypot(previous.end.x - previous.start.x,
            previous.end.y - previous.start.y) : 0;
          const oldAngle = previous ? Math.atan2(previous.end.y - previous.start.y,
            previous.end.x - previous.start.x) * 180 / Math.PI : 0;
          const polar = row.angle !== undefined || row.length !== undefined;
          if (!editing && !polar && (row.endX === undefined || row.endY === undefined))
            throw new Error('Specify a member endpoint or an angle and length.');
          if (!editing && polar && (row.angle === undefined || row.length === undefined))
            throw new Error('Specify both member angle and length.');
          const end = polar ? fbdMemberEndFromAngle(start,
            coordinate('length', oldLength), coordinate('angle', oldAngle)) : {
            x: coordinate('endX', previous?.end.x ?? 0),
            y: coordinate('endY', previous?.end.y ?? 0) };
          return { id, start, end, ...withLabel };
        })();
    return editing ? editFBDPrimitive(state, kind as FBDPrimitiveKind, id, item) :
      kind === 'body' ? addFBDBody(state, item as FBDBody) :
        kind === 'joint' ? addFBDJoint(state, item as FBDJoint) : addFBDMember(state, item as FBDMember);
  }
  if (name === 'fbd_move_primitive') {
    const row = args(value, ['kind', 'id', 'dx', 'dy'], ['kind', 'id', 'dx', 'dy']);
    const kind = str(row, 'kind') as FBDPrimitiveKind;
    if (!['body', 'joint', 'member'].includes(kind)) throw new Error('Invalid FBD base kind.');
    const id = str(row, 'id', 128);
    const old = getFBDElement(state, kind, id);
    if (!old) throw new Error('Unknown FBD base element.');
    const dx = num(row, 'dx'); const dy = num(row, 'dy');
    if (dx === 0 && dy === 0) throw new Error('Movement must be nonzero.');
    const shift = (point: { x: number; y: number }) => ({ x: point.x + dx, y: point.y + dy });
    const item = kind === 'body' ? { ...(old as FBDBody), origin: shift((old as FBDBody).origin) } :
      kind === 'joint' ? { ...(old as FBDJoint), at: shift((old as FBDJoint).at) } :
        { ...(old as FBDMember), start: shift((old as FBDMember).start), end: shift((old as FBDMember).end) };
    return editFBDPrimitive(state, kind, id, item);
  }
  if (name === 'fbd_add_force' || name === 'fbd_edit_force') {
    const editing = name === 'fbd_edit_force';
    const row = args(value, editing ? ['id', 'x', 'y', 'angle', 'label', 'magnitude'] : ['x', 'y', 'angle', 'label', 'magnitude'], editing ? ['id'] : ['x', 'y', 'angle', 'label']);
    const id = editing ? str(row, 'id', 128) : newId();
    const old = editing ? state.forces.find((item) => item.id === id) : undefined;
    if (editing && !old) throw new Error('Unknown FBD force.');
    if (editing) patch(row, 'id');
    const input = { at: { x: row.x === undefined ? old!.at.x : num(row, 'x'),
      y: row.y === undefined ? old!.at.y : num(row, 'y') },
      angle: row.angle === undefined ? old!.angle : num(row, 'angle'),
      label: row.label === undefined ? old!.label || '' : str(row, 'label', 80),
      ...(row.magnitude === undefined ? old?.magnitude === undefined ? {} : { magnitude: old.magnitude }
        : { magnitude: num(row, 'magnitude') }) };
    return editing ? editFBDForce(state, id, input, workspace) : addFBDForce(state, input, workspace, id);
  }
  if (name === 'fbd_add_moment' || name === 'fbd_edit_moment') {
    const editing = name === 'fbd_edit_moment';
    const row = args(value, editing ? ['id', 'x', 'y', 'clockwise', 'label', 'magnitude'] : ['x', 'y', 'clockwise', 'label', 'magnitude'], editing ? ['id'] : ['x', 'y', 'clockwise', 'label']);
    const id = editing ? str(row, 'id', 128) : newId();
    const old = editing ? state.moments.find((item) => item.id === id) : undefined;
    if (editing && !old) throw new Error('Unknown FBD moment.');
    if (editing) patch(row, 'id');
    const input = { at: { x: row.x === undefined ? old!.at.x : num(row, 'x'),
      y: row.y === undefined ? old!.at.y : num(row, 'y') },
      clockwise: row.clockwise === undefined ? old!.clockwise : bool(row, 'clockwise'),
      label: row.label === undefined ? old!.label || '' : str(row, 'label', 80),
      ...(row.magnitude === undefined ? old?.magnitude === undefined ? {} : { magnitude: old.magnitude }
        : { magnitude: num(row, 'magnitude') }) };
    return editing ? editFBDMoment(state, id, input, workspace) : addFBDMoment(state, input, workspace, id);
  }
  if (name === 'fbd_add_dimension' || name === 'fbd_edit_dimension') {
    const editing = name === 'fbd_edit_dimension';
    const row = args(value, editing ? ['id', 'startX', 'startY', 'endX', 'endY', 'label'] : ['startX', 'startY', 'endX', 'endY', 'label'],
      editing ? ['id'] : ['startX', 'startY', 'endX', 'endY', 'label']);
    const id = editing ? str(row, 'id', 128) : newId();
    const old = editing ? state.dimensions.find((item) => item.id === id) : undefined;
    if (editing && !old) throw new Error('Unknown FBD dimension.');
    if (editing) patch(row, 'id');
    const input = { start: { x: row.startX === undefined ? old!.start.x : num(row, 'startX'),
      y: row.startY === undefined ? old!.start.y : num(row, 'startY') },
      end: { x: row.endX === undefined ? old!.end.x : num(row, 'endX'),
        y: row.endY === undefined ? old!.end.y : num(row, 'endY') },
      label: row.label === undefined ? old!.label || '' : str(row, 'label') };
    return editing ? editFBDDimension(state, id, input, workspace) : addFBDDimension(state, input, workspace, id);
  }
  if (name === 'fbd_add_angle' || name === 'fbd_edit_angle') {
    const editing = name === 'fbd_edit_angle';
    const keys = ['vertexX', 'vertexY', 'fromX', 'fromY', 'toX', 'toY'] as const;
    const row = args(value, editing ? ['id', ...keys, 'label'] : [...keys, 'label'], editing ? ['id'] : [...keys, 'label']);
    const id = editing ? str(row, 'id', 128) : newId();
    const old = editing ? state.angles.find((item) => item.id === id) : undefined;
    if (editing && !old) throw new Error('Unknown FBD angle.');
    if (editing) patch(row, 'id');
    const coordinate = (key: typeof keys[number], fallback: number) => row[key] === undefined ? fallback : num(row, key);
    const input = { vertex: { x: coordinate('vertexX', old?.vertex.x ?? 0), y: coordinate('vertexY', old?.vertex.y ?? 0) },
      from: { x: coordinate('fromX', old?.from.x ?? 0), y: coordinate('fromY', old?.from.y ?? 0) },
      to: { x: coordinate('toX', old?.to.x ?? 0), y: coordinate('toY', old?.to.y ?? 0) },
      label: row.label === undefined ? old!.label || '' : str(row, 'label') };
    return editing ? editFBDAngle(state, id, input, workspace) : addFBDAngle(state, input, workspace, id);
  }
  if (name === 'fbd_add_label' || name === 'fbd_edit_label') {
    const editing = name === 'fbd_edit_label';
    const row = args(value, editing ? ['id', 'x', 'y', 'text'] : ['x', 'y', 'text'], editing ? ['id'] : ['x', 'y', 'text']);
    const id = editing ? str(row, 'id', 128) : newId();
    const old = editing ? state.labels.find((item) => item.id === id) : undefined;
    if (editing && !old) throw new Error('Unknown FBD label.');
    if (editing) patch(row, 'id');
    const input = { at: { x: row.x === undefined ? old!.at.x : num(row, 'x'),
      y: row.y === undefined ? old!.at.y : num(row, 'y') },
      text: row.text === undefined ? old!.text : str(row, 'text'),
      ...(old?.associatedWith ? { associatedWith: old.associatedWith } : {}) };
    return editing ? editFBDLabel(state, id, input, workspace) : addFBDLabel(state, input, workspace, id);
  }
  if (name === 'fbd_remove_element' || name === 'fbd_move_label') {
    const row = args(value, name === 'fbd_remove_element' ? ['kind', 'id'] : ['kind', 'id', 'x', 'y'],
      name === 'fbd_remove_element' ? ['kind', 'id'] : ['kind', 'id', 'x', 'y']);
    const kind = str(row, 'kind') as FBDElementKind;
    if (!['body', 'joint', 'member', 'force', 'moment', 'dimension', 'angle', 'label'].includes(kind)) throw new Error('Invalid FBD element kind.');
    if (name === 'fbd_move_label' && ['body', 'joint', 'member'].includes(kind))
      throw new Error('Use fbd_move_primitive to move a body, joint, or member.');
    const id = str(row, 'id', 128);
    return name === 'fbd_remove_element' ? deleteFBDElement(state, kind, id) :
      repositionFBDLabel(state, kind, id, { x: num(row, 'x'), y: num(row, 'y') });
  }
  if (name === 'fbd_select_object') {
    const row = args(value, ['kind', 'id'], ['kind', 'id']);
    const kind = str(row, 'kind');
    if (!['body', 'member', 'joint'].includes(kind)) throw new Error('Invalid FBD object kind.');
    if (state.bodies.length || state.joints.length || state.members.length || state.forces.length || state.moments.length || state.dimensions.length || state.angles.length || state.labels.length)
      throw new Error('The current FBD has student work. Choose the object in the FBD toolbar and confirm replacement.');
    return selectFBDTarget(state, { kind: kind as 'body' | 'member' | 'joint', id: str(row, 'id', 128) }, workspace);
  }
  throw new Error('Unknown FBD tool.');
}

export function executeFBDChatToolBatch(workspace: StaticsWorkspace, state: FBDState,
  calls: FBDChatToolCall[], message: string, onChange?: (next: FBDState) => void,
  newId = () => crypto.randomUUID()): FBDChatBatch {
  if (!Array.isArray(calls) || !calls.length || calls.length > 8) throw new Error('Invalid FBD tool call count.');
  let current = state;
  const interactions: FBDChatInteraction[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    if (!call || typeof call.id !== 'string' || !call.id || call.id.length > 128 || seen.has(call.id))
      throw new Error('Invalid FBD tool call ID.');
    seen.add(call.id);
    const before = current;
    let result: FBDChatToolResult;
    try {
      if (!explicitlyRequestsFBDModification(message)) throw new Error('Advice alone cannot change your FBD. Ask for a specific FBD edit.');
      if (!FBD_CHAT_TOOL_NAMES.includes(call.name as FBDChatToolName)) throw new Error('Unknown FBD tool.');
      current = applyFBDChatTool(current, workspace, call, newId);
      if (current !== before) onChange?.(current);
      result = { id: call.id, name: call.name, success: true, result: `Applied ${call.name}.` };
    } catch (error) {
      result = { id: call.id, name: call.name, success: false,
        error: error instanceof Error ? error.message : 'FBD tool failed.' };
    }
    interactions.push({ call, result, before, after: current });
  }
  return { state: current, results: interactions.map((item) => item.result), interactions };
}

export function formatFBDChatToolBatch(batch: FBDChatBatch): string {
  return batch.results.map((result) => result.success
    ? `- ${result.name}: completed. Your FBD was updated from the validated tool result.`
    : `- ${result.name}: not completed. ${result.error}`).join('\n');
}
