import type { EngineeringToolBatch } from './engineeringTools.ts';
import type { FBDChatBatch } from './fbdChatTools.ts';
import type { FBDCheckResult } from './checkFBD.ts';
import type { FBDAngle, FBDDimension, FBDForce, FBDMoment, FBDLabel,
  FBDElement, FBDElementKind, FBDState, FBDTarget } from './fbdState.ts';

export type VisualizationAction = 'front' | 'top' | 'right' | 'isometric' | 'reset' | 'free' | 'orbit' | 'fbd' |
  'structure_view' | 'fbd_view' | 'split_view' |
  `fbd_given_${'loads' | 'dimensions' | 'angles' | 'labels'}_${'on' | 'off'}` |
  'fbd_enter' | 'fbd_exit' | 'fbd_select' | 'fbd_delete' | 'fbd_undo' | 'fbd_redo' | 'fbd_reset' | 'fbd_force_add' | 'fbd_moment_add' | 'fbd_dimension_add' | 'fbd_angle_add' | 'fbd_label_add' | 'fbd_label_move' | 'fbd_element_edit' | 'fbd_element_delete' | 'fbd_element_drag' | 'fbd_element_reposition';
export type FBDResearchContext = {
  problemId: string; isolatedObject: FBDTarget | null; actionType: string;
  elementType: FBDElementKind | null; elementId: string | null;
  stateBefore: FBDState; stateAfter: FBDState;
  inputModality: 'text' | 'audio' | null; relatedStudentChatMessage: string | null;
  sequence: number;
};
export type EngineeringResearchEvent = {
  kind: 'tool'; eventId: string; sessionId: string; timestamp: string;
  studentMessage: string; toolName: string; toolArguments: unknown;
  stateBefore: EngineeringToolBatch['workspace']; stateAfter: EngineeringToolBatch['workspace'];
  solverResult?: unknown; aiResponse: string; succeeded: boolean; error?: string;
} | {
  kind: 'fbd_tool'; eventId: string; sessionId: string; timestamp: string;
  studentMessage: string; toolName: string; toolArguments: unknown;
  stateBefore: FBDState; stateAfter: FBDState;
  aiResponse: string; succeeded: boolean; error?: string;
  fbdResearch?: FBDResearchContext;
} | {
  kind: 'fbd_check'; eventId: string; sessionId: string; timestamp: string;
  studentMessage: string; fbdState: FBDState;
  comparisonResult: FBDCheckResult; feedback: string;
  fbdResearch?: FBDResearchContext;
} | {
  kind: 'visualization'; eventId: string; sessionId: string; timestamp: string; action: VisualizationAction;
  target?: FBDTarget; force?: FBDForce; moment?: FBDMoment; dimension?: FBDDimension; angle?: FBDAngle; label?: FBDLabel;
  elementKind?: FBDElementKind; elementId?: string; before?: FBDElement; after?: FBDElement | null;
  dragTarget?: 'label' | 'application';
  fbdBefore?: FBDState; fbdAfter?: FBDState;
  fbdResearch?: FBDResearchContext;
};

export function nextFBDResearchSequence(storage: Pick<Storage, 'getItem' | 'setItem'>,
  sessionId: string): number {
  const key = `mydis-fbd-sequence:${encodeURIComponent(sessionId)}`;
  const previous = Number(storage.getItem(key));
  const next = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
  storage.setItem(key, String(next));
  return next;
}

export function fbdActionForVisualization(action: VisualizationAction,
  kind?: FBDElementKind): string {
  if (action === 'fbd_enter') return 'enter_fbd_mode';
  if (action === 'fbd_exit') return 'exit_fbd_mode';
  if (action === 'fbd_select' || action === 'fbd_delete') return 'select_body';
  if (action === 'fbd_undo') return 'undo';
  if (action === 'fbd_redo') return 'redo';
  if (action === 'fbd_reset') return 'reset_fbd';
  if (action === 'fbd_force_add') return 'add_force';
  if (action === 'fbd_moment_add') return 'add_moment';
  if (action === 'fbd_dimension_add') return 'add_dimension';
  if (action === 'fbd_angle_add') return 'add_angle';
  if (action === 'fbd_label_add') return 'add_label';
  if (action === 'fbd_element_delete') return `delete_${kind}`;
  if (action === 'fbd_element_edit') return `edit_${kind}`;
  if (action === 'fbd_element_drag' || action === 'fbd_element_reposition' || action === 'fbd_label_move')
    return `move_${kind || 'label'}`;
  if (action.startsWith('fbd_given_')) return 'show_given_information';
  return 'view_change';
}

export function createFBDResearchContext(actionType: string, before: FBDState,
  after: FBDState, sequence: number, elementType: FBDElementKind | null = null,
  elementId: string | null = null, inputModality: 'text' | 'audio' | null = null,
  relatedStudentChatMessage: string | null = null): FBDResearchContext {
  return { problemId: after.sourceStructureKey, isolatedObject: after.selectedTarget,
    actionType, elementType, elementId, stateBefore: before, stateAfter: after,
    inputModality, relatedStudentChatMessage, sequence };
}

export function fbdToolElement(before: FBDState, after: FBDState,
  toolName: string, args: unknown): { actionType: string; elementType: FBDElementKind | null; elementId: string | null } {
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = null; }
  }
  const match = /^fbd_(add|edit)_(force|moment|dimension|angle|label)$/.exec(toolName);
  const argumentKind = args && typeof args === 'object' && !Array.isArray(args)
    ? (args as { kind?: unknown }).kind : null;
  const elementType = (match?.[2] ||
    (['force', 'moment', 'dimension', 'angle', 'label'].includes(String(argumentKind))
      ? argumentKind : null)) as FBDElementKind | null;
  const collection = elementType ? `${elementType}s` as keyof FBDState : null;
  const beforeIds = collection ? new Set((before[collection] as { id: string }[]).map((item) => item.id)) : null;
  const afterIds = collection ? (after[collection] as { id: string }[]).map((item) => item.id) : [];
  const argId = args && typeof args === 'object' && !Array.isArray(args) &&
    typeof (args as { id?: unknown }).id === 'string' ? (args as { id: string }).id : null;
  const elementId = !elementType ? null : match?.[1] === 'add'
    ? afterIds.find((id) => !beforeIds?.has(id)) || null : argId;
  const actionType = match ? `${match[1]}_${elementType}` :
    toolName === 'fbd_remove_element' ? `delete_${elementType}` :
    toolName === 'fbd_move_label' ? 'move_label' :
    toolName === 'fbd_select_object' ? 'select_body' : 'request_ai_help';
  return { actionType, elementType, elementId };
}

export function getEngineeringSessionId(storage: Pick<Storage, 'getItem' | 'setItem'>,
  userId: string, newId = () => crypto.randomUUID()): string {
  if (!userId) throw new Error('User ID is required for research logging.');
  const key = `mydis-engineering-session:${encodeURIComponent(userId)}`;
  const existing = storage.getItem(key);
  if (existing) return existing;
  const sessionId = newId();
  storage.setItem(key, sessionId);
  return sessionId;
}

export function createToolResearchEvents(sessionId: string, studentMessage: string,
  batch: EngineeringToolBatch, aiResponse: string,
  newId = () => crypto.randomUUID(), now = () => new Date().toISOString()): EngineeringResearchEvent[] {
  return batch.interactions.map((interaction) => ({
    kind: 'tool', eventId: newId(), sessionId, timestamp: now(), studentMessage,
    toolName: interaction.call.name, toolArguments: interaction.call.arguments ?? null,
    stateBefore: interaction.before, stateAfter: interaction.after,
    ...(interaction.calculation ? { solverResult: interaction.calculation } :
      interaction.calculationError ? { solverResult: { error: interaction.calculationError } } : {}),
    aiResponse, succeeded: interaction.result.success,
    ...(interaction.result.error ? { error: interaction.result.error } : {}),
  }));
}

export function createFBDToolResearchEvents(sessionId: string, studentMessage: string,
  batch: FBDChatBatch, aiResponse: string,
  newId = () => crypto.randomUUID(), now = () => new Date().toISOString()): EngineeringResearchEvent[] {
  return batch.interactions.map((interaction) => ({
    kind: 'fbd_tool', eventId: newId(), sessionId, timestamp: now(), studentMessage,
    toolName: interaction.call.name, toolArguments: interaction.call.arguments,
    stateBefore: interaction.before, stateAfter: interaction.after,
    aiResponse, succeeded: interaction.result.success,
    ...(interaction.result.error ? { error: interaction.result.error } : {}),
  }));
}

export function createFBDCheckResearchEvent(sessionId: string, studentMessage: string,
  fbdState: FBDState, comparisonResult: FBDCheckResult, feedback: string,
  newId = () => crypto.randomUUID(), now = () => new Date().toISOString()): EngineeringResearchEvent {
  return { kind: 'fbd_check', eventId: newId(), sessionId, timestamp: now(),
    studentMessage, fbdState, comparisonResult, feedback };
}

export function createVisualizationResearchEvent(sessionId: string, action: VisualizationAction,
  newId = () => crypto.randomUUID(), now = () => new Date().toISOString(),
  target?: FBDTarget, force?: FBDForce, moment?: FBDMoment,
  dimension?: FBDDimension, angle?: FBDAngle, label?: FBDLabel,
  change?: { elementKind: FBDElementKind; elementId: string; before: FBDElement;
    after: FBDElement | null; dragTarget?: 'label' | 'application' },
  history?: { before: FBDState; after: FBDState }): EngineeringResearchEvent {
  return { kind: 'visualization', eventId: newId(), sessionId, timestamp: now(), action,
    ...(target ? { target } : {}), ...(force ? { force } : {}), ...(moment ? { moment } : {}),
    ...(dimension ? { dimension } : {}), ...(angle ? { angle } : {}), ...(label ? { label } : {}),
    ...(change || {}), ...(history && ['fbd_select', 'fbd_delete', 'fbd_undo', 'fbd_redo', 'fbd_reset'].includes(action)
      ? { fbdBefore: history.before, fbdAfter: history.after } : {}) };
}
