import type { StaticsWorkspace } from './model.ts';

export type FBDTarget = { kind: 'body' | 'member' | 'joint'; id: string };
export type FBDPoint = { x: number; y: number };
export type FBDForce = { id: string; at: FBDPoint; angle: number; magnitude?: number; label?: string; labelPosition?: FBDPoint };
export type FBDForceInput = { at: FBDPoint; angle: number; label: string; magnitude?: number };
export type FBDMoment = { id: string; at: FBDPoint; clockwise: boolean; magnitude?: number; label?: string; labelPosition?: FBDPoint };
export type FBDMomentInput = { at: FBDPoint; clockwise: boolean; label: string; magnitude?: number };
export type FBDDimension = { id: string; start: FBDPoint; end: FBDPoint; label?: string; labelPosition?: FBDPoint };
export type FBDDimensionInput = { start: FBDPoint; end: FBDPoint; label: string };
export type FBDAngle = { id: string; vertex: FBDPoint; from: FBDPoint; to: FBDPoint; label?: string; labelPosition?: FBDPoint };
export type FBDAngleInput = { vertex: FBDPoint; from: FBDPoint; to: FBDPoint; label: string };
export type FBDLabelAssociation = { kind: 'force' | 'moment' | 'node' | 'member' | 'dimension' | 'angle'; id: string };
export type FBDLabel = { id: string; at: FBDPoint; text: string; associatedWith?: FBDLabelAssociation };
export type FBDLabelInput = { at: FBDPoint; text: string; associatedWith?: FBDLabelAssociation };
export type FBDElementKind = 'force' | 'moment' | 'dimension' | 'angle' | 'label';
export type FBDElement = FBDForce | FBDMoment | FBDDimension | FBDAngle | FBDLabel;

/** Student-created diagram data. EngineeringState is never copied or edited here. */
export interface FBDState {
  version: 1;
  sourceStructureKey: string;
  selectedTarget: FBDTarget | null;
  forces: FBDForce[];
  moments: FBDMoment[];
  dimensions: FBDDimension[];
  angles: FBDAngle[];
  labels: FBDLabel[];
}

export interface FBDStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function engineeringStructureKey(workspace: StaticsWorkspace): string {
  const text = JSON.stringify(workspace);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return `structure-${(hash >>> 0).toString(16)}`;
}

export function createEmptyFBDState(workspace: StaticsWorkspace): FBDState {
  return { version: 1, sourceStructureKey: engineeringStructureKey(workspace), selectedTarget: null,
    forces: [], moments: [], dimensions: [], angles: [], labels: [] };
}

function validTarget(target: FBDTarget, workspace: StaticsWorkspace): boolean {
  return target.kind === 'body' ? target.id === 'structure' :
    target.kind === 'member' ? workspace.members.some((member) => member.id === target.id) :
      target.kind === 'joint' && workspace.nodes.some((node) => node.id === target.id);
}

export function selectFBDTarget(state: FBDState, target: FBDTarget | null,
  workspace: StaticsWorkspace): FBDState {
  if (target && !validTarget(target, workspace)) throw new Error('Unknown FBD body, member, or joint.');
  return { ...state, sourceStructureKey: engineeringStructureKey(workspace),
    selectedTarget: target ? { ...target } : null };
}

/** Adds only student supplied values; this never changes the engineering model or calls a solver. */
export function addFBDForce(state: FBDState, input: FBDForceInput, workspace: StaticsWorkspace,
  forceId: string): FBDState {
  if (!state.selectedTarget || !validTarget(state.selectedTarget, workspace))
    throw new Error('Select a body, member, or joint before adding a force.');
  if (!forceId.trim() || state.forces.some((force) => force.id === forceId))
    throw new Error('Force ID must be unique.');
  if (!Number.isFinite(input.at.x) || !Number.isFinite(input.at.y) || !Number.isFinite(input.angle) ||
    !input.label.trim() || input.label.length > 80 ||
    (input.magnitude !== undefined && (!Number.isFinite(input.magnitude) || input.magnitude < 0)))
    throw new Error('Enter a valid point, label, direction, and optional nonnegative magnitude.');
  const force: FBDForce = { id: forceId, at: { x: input.at.x, y: input.at.y },
    angle: input.angle, label: input.label.trim(),
    ...(input.magnitude === undefined ? {} : { magnitude: input.magnitude }) };
  return { ...state, sourceStructureKey: engineeringStructureKey(workspace),
    forces: [...state.forces, force] };
}

/** Records only the student's moment annotation; no equilibrium calculation is performed. */
export function addFBDMoment(state: FBDState, input: FBDMomentInput, workspace: StaticsWorkspace,
  momentId: string): FBDState {
  if (!state.selectedTarget || !validTarget(state.selectedTarget, workspace))
    throw new Error('Select a body, member, or joint before adding a moment.');
  if (!momentId.trim() || state.moments.some((moment) => moment.id === momentId))
    throw new Error('Moment ID must be unique.');
  if (!Number.isFinite(input.at.x) || !Number.isFinite(input.at.y) ||
    typeof input.clockwise !== 'boolean' || !input.label.trim() || input.label.length > 80 ||
    (input.magnitude !== undefined && (!Number.isFinite(input.magnitude) || input.magnitude < 0)))
    throw new Error('Enter a valid point, label, direction, and optional nonnegative magnitude.');
  const moment: FBDMoment = { id: momentId, at: { x: input.at.x, y: input.at.y },
    clockwise: input.clockwise, label: input.label.trim(),
    ...(input.magnitude === undefined ? {} : { magnitude: input.magnitude }) };
  return { ...state, sourceStructureKey: engineeringStructureKey(workspace),
    moments: [...state.moments, moment] };
}

/** The label is supplied by the student; endpoint geometry never determines its value. */
export function addFBDDimension(state: FBDState, input: FBDDimensionInput,
  workspace: StaticsWorkspace, dimensionId: string): FBDState {
  if (!state.selectedTarget || !validTarget(state.selectedTarget, workspace))
    throw new Error('Select a body, member, or joint before adding a dimension.');
  if (!dimensionId.trim() || state.dimensions.some((dimension) => dimension.id === dimensionId))
    throw new Error('Dimension ID must be unique.');
  const { start, end } = input;
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite) ||
    Math.hypot(end.x - start.x, end.y - start.y) < 1e-9 ||
    !input.label.trim() || input.label.length > 120)
    throw new Error('Enter two distinct points and dimension text.');
  const dimension: FBDDimension = { id: dimensionId,
    start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, label: input.label.trim() };
  return { ...state, sourceStructureKey: engineeringStructureKey(workspace),
    dimensions: [...state.dimensions, dimension] };
}

/** Stores two student-chosen reference rays and their text without finding an angle value. */
export function addFBDAngle(state: FBDState, input: FBDAngleInput,
  workspace: StaticsWorkspace, angleId: string): FBDState {
  if (!state.selectedTarget || !validTarget(state.selectedTarget, workspace))
    throw new Error('Select a body, member, or joint before adding an angle.');
  if (!angleId.trim() || state.angles.some((angle) => angle.id === angleId))
    throw new Error('Angle ID must be unique.');
  const { vertex, from, to } = input;
  if (![vertex.x, vertex.y, from.x, from.y, to.x, to.y].every(Number.isFinite) ||
    !input.label.trim() || input.label.length > 120)
    throw new Error('Enter a vertex, two reference directions, and angle text.');
  const first = { x: from.x - vertex.x, y: from.y - vertex.y };
  const second = { x: to.x - vertex.x, y: to.y - vertex.y };
  const firstLength = Math.hypot(first.x, first.y);
  const secondLength = Math.hypot(second.x, second.y);
  if (firstLength < 1e-9 || secondLength < 1e-9 ||
    (Math.abs(first.x * second.y - first.y * second.x) / (firstLength * secondLength) < 1e-9 &&
      first.x * second.x + first.y * second.y > 0))
    throw new Error('Choose two distinct reference directions from the vertex.');
  const angle: FBDAngle = { id: angleId,
    vertex: { x: vertex.x, y: vertex.y }, from: { x: from.x, y: from.y },
    to: { x: to.x, y: to.y }, label: input.label.trim() };
  return { ...state, sourceStructureKey: engineeringStructureKey(workspace), angles: [...state.angles, angle] };
}

function validLabelAssociation(state: FBDState, workspace: StaticsWorkspace, association: FBDLabelAssociation) {
  const { kind, id } = association;
  return kind === 'node' ? workspace.nodes.some((node) => node.id === id) :
    kind === 'member' ? workspace.members.some((member) => member.id === id) :
    kind === 'force' ? state.forces.some((force) => force.id === id) :
    kind === 'moment' ? state.moments.some((moment) => moment.id === id) :
    kind === 'dimension' ? state.dimensions.some((dimension) => dimension.id === id) :
    kind === 'angle' && state.angles.some((angle) => angle.id === id);
}

export function addFBDLabel(state: FBDState, input: FBDLabelInput,
  workspace: StaticsWorkspace, labelId: string): FBDState {
  if (!state.selectedTarget || !validTarget(state.selectedTarget, workspace))
    throw new Error('Select a body, member, or joint before adding a label.');
  if (!labelId.trim() || state.labels.some((label) => label.id === labelId))
    throw new Error('Label ID must be unique.');
  if (!Number.isFinite(input.at.x) || !Number.isFinite(input.at.y) ||
    !input.text.trim() || input.text.length > 120)
    throw new Error('Enter valid label text and a finite position.');
  if (input.associatedWith && !validLabelAssociation(state, workspace, input.associatedWith))
    throw new Error('Unknown FBD label association.');
  const label: FBDLabel = { id: labelId, at: { ...input.at }, text: input.text.trim(),
    ...(input.associatedWith ? { associatedWith: { ...input.associatedWith } } : {}) };
  return { ...state, sourceStructureKey: engineeringStructureKey(workspace), labels: [...state.labels, label] };
}

export function moveFBDLabel(state: FBDState, labelId: string, at: FBDPoint): FBDState {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error('Enter a finite label position.');
  if (!state.labels.some((label) => label.id === labelId)) throw new Error('Unknown FBD label.');
  return { ...state, labels: state.labels.map((label) => label.id === labelId
    ? { ...label, at: { x: at.x, y: at.y } } : label) };
}

/** Repositions annotation text only. Geometry, forces, and points of application stay intact. */
export function repositionFBDLabel(state: FBDState, kind: FBDElementKind, id: string,
  position: FBDPoint): FBDState {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y))
    throw new Error('Enter a finite label position.');
  if (!getFBDElement(state, kind, id)) throw new Error('Unknown FBD element.');
  if (kind === 'label') return moveFBDLabel(state, id, position);
  const withPosition = <T extends { id: string; labelPosition?: FBDPoint }>(items: T[]) =>
    items.map((item) => item.id === id ? { ...item, labelPosition: { ...position } } : item);
  return { ...state,
    forces: kind === 'force' ? withPosition(state.forces) : state.forces,
    moments: kind === 'moment' ? withPosition(state.moments) : state.moments,
    dimensions: kind === 'dimension' ? withPosition(state.dimensions) : state.dimensions,
    angles: kind === 'angle' ? withPosition(state.angles) : state.angles };
}

/** An explicit physical operation, never the consequence of dragging annotation text. */
export function moveFBDForceApplication(state: FBDState, id: string, at: FBDPoint,
  workspace: StaticsWorkspace): FBDState {
  const force = state.forces.find((item) => item.id === id);
  if (!force) throw new Error('Unknown FBD force.');
  return editFBDForce(state, id, { at, angle: force.angle, label: force.label || '',
    ...(force.magnitude === undefined ? {} : { magnitude: force.magnitude }) }, workspace);
}

const editTarget: FBDTarget = { kind: 'body', id: 'structure' };
function replaceElement<T extends { id: string }>(items: T[], id: string, replacement: T): T[] {
  if (!items.some((item) => item.id === id)) throw new Error('Unknown FBD element.');
  return items.map((item) => item.id === id ? replacement : item);
}

/** Validate edits through the same constructors used to add each student annotation. */
export function editFBDForce(state: FBDState, id: string, input: FBDForceInput,
  workspace: StaticsWorkspace): FBDState {
  if (!state.forces.some((item) => item.id === id)) throw new Error('Unknown FBD force.');
  const valid = addFBDForce({ ...state, selectedTarget: editTarget,
    forces: state.forces.filter((item) => item.id !== id) }, input, workspace, id).forces.at(-1)!;
  const existing = state.forces.find((item) => item.id === id)!;
  return { ...state, forces: replaceElement(state.forces, id,
    existing.labelPosition ? { ...valid, labelPosition: { ...existing.labelPosition } } : valid) };
}
export function editFBDMoment(state: FBDState, id: string, input: FBDMomentInput,
  workspace: StaticsWorkspace): FBDState {
  if (!state.moments.some((item) => item.id === id)) throw new Error('Unknown FBD moment.');
  const valid = addFBDMoment({ ...state, selectedTarget: editTarget,
    moments: state.moments.filter((item) => item.id !== id) }, input, workspace, id).moments.at(-1)!;
  const existing = state.moments.find((item) => item.id === id)!;
  return { ...state, moments: replaceElement(state.moments, id,
    existing.labelPosition ? { ...valid, labelPosition: { ...existing.labelPosition } } : valid) };
}
export function editFBDDimension(state: FBDState, id: string, input: FBDDimensionInput,
  workspace: StaticsWorkspace): FBDState {
  if (!state.dimensions.some((item) => item.id === id)) throw new Error('Unknown FBD dimension.');
  const valid = addFBDDimension({ ...state, selectedTarget: editTarget,
    dimensions: state.dimensions.filter((item) => item.id !== id) }, input, workspace, id).dimensions.at(-1)!;
  const existing = state.dimensions.find((item) => item.id === id)!;
  return { ...state, dimensions: replaceElement(state.dimensions, id,
    existing.labelPosition ? { ...valid, labelPosition: { ...existing.labelPosition } } : valid) };
}
export function editFBDAngle(state: FBDState, id: string, input: FBDAngleInput,
  workspace: StaticsWorkspace): FBDState {
  if (!state.angles.some((item) => item.id === id)) throw new Error('Unknown FBD angle.');
  const valid = addFBDAngle({ ...state, selectedTarget: editTarget,
    angles: state.angles.filter((item) => item.id !== id) }, input, workspace, id).angles.at(-1)!;
  const existing = state.angles.find((item) => item.id === id)!;
  return { ...state, angles: replaceElement(state.angles, id,
    existing.labelPosition ? { ...valid, labelPosition: { ...existing.labelPosition } } : valid) };
}
export function editFBDLabel(state: FBDState, id: string, input: FBDLabelInput,
  workspace: StaticsWorkspace): FBDState {
  if (!state.labels.some((item) => item.id === id)) throw new Error('Unknown FBD label.');
  const valid = addFBDLabel({ ...state, selectedTarget: editTarget,
    labels: state.labels.filter((item) => item.id !== id) }, input, workspace, id).labels.at(-1)!;
  return { ...state, labels: replaceElement(state.labels, id, valid) };
}

export function getFBDElement(state: FBDState, kind: FBDElementKind, id: string): FBDElement | undefined {
  const collection = kind === 'force' ? state.forces : kind === 'moment' ? state.moments :
    kind === 'dimension' ? state.dimensions : kind === 'angle' ? state.angles : state.labels;
  return collection.find((item) => item.id === id);
}

export function deleteFBDElement(state: FBDState, kind: FBDElementKind, id: string): FBDState {
  if (!getFBDElement(state, kind, id)) throw new Error('Unknown FBD element.');
  const remainingLabels = kind === 'label' ? state.labels.filter((item) => item.id !== id) :
    state.labels.map((item) => item.associatedWith?.kind === kind && item.associatedWith.id === id
      ? { id: item.id, at: item.at, text: item.text } : item);
  return { ...state,
    forces: kind === 'force' ? state.forces.filter((item) => item.id !== id) : state.forces,
    moments: kind === 'moment' ? state.moments.filter((item) => item.id !== id) : state.moments,
    dimensions: kind === 'dimension' ? state.dimensions.filter((item) => item.id !== id) : state.dimensions,
    angles: kind === 'angle' ? state.angles.filter((item) => item.id !== id) : state.angles,
    labels: remainingLabels };
}

export interface FBDHistory { present: FBDState; past: FBDState[]; future: FBDState[] }
export const createFBDHistory = (present: FBDState): FBDHistory => ({ present, past: [], future: [] });
export function applyFBDChange(history: FBDHistory, next: FBDState): FBDHistory {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  return { present: next, past: [...history.past, history.present].slice(-50), future: [] };
}
export function undoFBDChange(history: FBDHistory): FBDHistory {
  if (!history.past.length) return history;
  return { present: history.past[history.past.length - 1], past: history.past.slice(0, -1),
    future: [history.present, ...history.future] };
}
export function redoFBDChange(history: FBDHistory): FBDHistory {
  if (!history.future.length) return history;
  return { present: history.future[0], past: [...history.past, history.present].slice(-50),
    future: history.future.slice(1) };
}

export function associateFBDState(state: FBDState, workspace: StaticsWorkspace): FBDState {
  return { ...state, sourceStructureKey: engineeringStructureKey(workspace),
    selectedTarget: state.selectedTarget && validTarget(state.selectedTarget, workspace)
      ? state.selectedTarget : null };
}

export function parseFBDState(input: unknown, workspace: StaticsWorkspace): FBDState {
  const fail = (): never => { throw new Error('Invalid FBD state.'); };
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
  const id = (value: unknown): string => typeof value === 'string' && value.trim() ? value : fail();
  const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : fail();
  const point = (value: unknown): FBDPoint => { const row = object(value); return { x: number(row.x), y: number(row.y) }; };
  const label = (value: unknown): string | undefined => value === undefined ? undefined : typeof value === 'string' ? value : fail();
  const rows = <T>(value: unknown, read: (item: Record<string, unknown>) => T): T[] =>
    Array.isArray(value) ? value.map((item) => read(object(item))) : fail();
  const root = object(input);
  if (root.version !== 1) fail();
  const target = root.selectedTarget === null ? null : object(root.selectedTarget);
  const selectedTarget: FBDTarget | null = target ? {
    kind: target.kind === 'body' || target.kind === 'member' || target.kind === 'joint' ? target.kind : fail(),
    id: id(target.id),
  } : null;
  const output: FBDState = {
    version: 1, sourceStructureKey: id(root.sourceStructureKey), selectedTarget,
    forces: rows(root.forces, (row) => ({ id: id(row.id), at: point(row.at), angle: number(row.angle),
      ...(row.magnitude === undefined ? {} : { magnitude: number(row.magnitude) }),
      ...(row.label === undefined ? {} : { label: label(row.label) }),
      ...(row.labelPosition === undefined ? {} : { labelPosition: point(row.labelPosition) }) })),
    moments: rows(root.moments, (row) => ({ id: id(row.id), at: point(row.at),
      clockwise: typeof row.clockwise === 'boolean' ? row.clockwise : fail(),
      ...(row.magnitude === undefined ? {} : { magnitude: number(row.magnitude) }),
      ...(row.label === undefined ? {} : { label: label(row.label) }),
      ...(row.labelPosition === undefined ? {} : { labelPosition: point(row.labelPosition) }) })),
    dimensions: rows(root.dimensions, (row) => ({ id: id(row.id), start: point(row.start), end: point(row.end),
      ...(row.label === undefined ? {} : { label: label(row.label) }),
      ...(row.labelPosition === undefined ? {} : { labelPosition: point(row.labelPosition) }) })),
    angles: rows(root.angles, (row) => ({ id: id(row.id), vertex: point(row.vertex),
      from: point(row.from), to: point(row.to), ...(row.label === undefined ? {} : { label: label(row.label) }),
      ...(row.labelPosition === undefined ? {} : { labelPosition: point(row.labelPosition) }) })),
    labels: rows(root.labels, (row) => {
      const association = row.associatedWith === undefined ? undefined : object(row.associatedWith);
      const kind = association?.kind;
      const validKind = kind === 'force' || kind === 'moment' || kind === 'node' ||
        kind === 'member' || kind === 'dimension' || kind === 'angle';
      if (association && !validKind) fail();
      return { id: id(row.id), at: point(row.at), text: id(row.text),
        ...(association ? { associatedWith: { kind: kind as FBDLabelAssociation['kind'], id: id(association.id) } } : {}) };
    }),
  };
  for (const key of ['forces', 'moments', 'dimensions', 'angles', 'labels'] as const) {
    if (new Set(output[key].map((item) => item.id)).size !== output[key].length) fail();
  }
  output.labels = output.labels.map((item) => item.associatedWith &&
    !validLabelAssociation(output, workspace, item.associatedWith)
    ? { id: item.id, at: item.at, text: item.text } : item);
  return associateFBDState(output, workspace);
}

export const fbdStorageKey = (userId: string) => `mydis-fbd:v1:${encodeURIComponent(userId)}`;
export function loadFBDState(storage: FBDStorage, userId: string, workspace: StaticsWorkspace): FBDState {
  if (!userId.trim()) throw new Error('User ID is required.');
  try {
    const saved = storage.getItem(fbdStorageKey(userId));
    return saved ? parseFBDState(JSON.parse(saved), workspace) : createEmptyFBDState(workspace);
  } catch (error) {
    console.warn('Could not restore FBD state; starting empty.', error);
    return createEmptyFBDState(workspace);
  }
}
export function saveFBDState(storage: FBDStorage, userId: string, state: FBDState,
  workspace: StaticsWorkspace): void {
  if (!userId.trim()) throw new Error('User ID is required.');
  storage.setItem(fbdStorageKey(userId), JSON.stringify(parseFBDState(state, workspace)));
}

/** Viewer calls this only for Structure Mode; Build FBD Mode cannot invoke the solver. */
export function visibleReactions<T>(buildFbdMode: boolean, workspace: StaticsWorkspace,
  solve: (value: StaticsWorkspace) => T): { result: T | null; error: string } {
  if (buildFbdMode) return { result: null, error: '' };
  try { return { result: solve(workspace), error: '' }; }
  catch (error) { return { result: null, error: error instanceof Error ? error.message : 'Cannot calculate reactions.' }; }
}
