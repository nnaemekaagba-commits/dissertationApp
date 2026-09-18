import type { EngineeringToolBatch } from './engineeringTools.ts';
import type { FBDAngle, FBDDimension, FBDForce, FBDMoment, FBDLabel,
  FBDElement, FBDElementKind, FBDState, FBDTarget } from './fbdState.ts';

export type VisualizationAction = 'front' | 'top' | 'right' | 'isometric' | 'reset' | 'free' | 'orbit' | 'fbd' |
  'structure_view' | 'fbd_view' | 'split_view' |
  `fbd_given_${'loads' | 'dimensions' | 'angles' | 'labels'}_${'on' | 'off'}` |
  'fbd_enter' | 'fbd_exit' | 'fbd_select' | 'fbd_delete' | 'fbd_undo' | 'fbd_redo' | 'fbd_reset' | 'fbd_force_add' | 'fbd_moment_add' | 'fbd_dimension_add' | 'fbd_angle_add' | 'fbd_label_add' | 'fbd_label_move' | 'fbd_element_edit' | 'fbd_element_delete' | 'fbd_element_drag' | 'fbd_element_reposition';
export type EngineeringResearchEvent = {
  kind: 'tool'; eventId: string; sessionId: string; timestamp: string;
  studentMessage: string; toolName: string; toolArguments: unknown;
  stateBefore: EngineeringToolBatch['workspace']; stateAfter: EngineeringToolBatch['workspace'];
  solverResult?: unknown; aiResponse: string; succeeded: boolean; error?: string;
} | {
  kind: 'visualization'; eventId: string; sessionId: string; timestamp: string; action: VisualizationAction;
  target?: FBDTarget; force?: FBDForce; moment?: FBDMoment; dimension?: FBDDimension; angle?: FBDAngle; label?: FBDLabel;
  elementKind?: FBDElementKind; elementId?: string; before?: FBDElement; after?: FBDElement | null;
  dragTarget?: 'label' | 'application';
  fbdBefore?: FBDState; fbdAfter?: FBDState;
};

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
    ...(change || {}), ...(history ? { fbdBefore: history.before, fbdAfter: history.after } : {}) };
}
