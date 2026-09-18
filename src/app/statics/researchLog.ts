import type { EngineeringToolBatch } from './engineeringTools.ts';
import type { FBDForce, FBDTarget } from './fbdState.ts';

export type VisualizationAction = 'front' | 'top' | 'right' | 'isometric' | 'reset' | 'free' | 'orbit' | 'fbd' |
  'fbd_enter' | 'fbd_exit' | 'fbd_select' | 'fbd_delete' | 'fbd_undo' | 'fbd_redo' | 'fbd_reset' | 'fbd_force_add';
export type EngineeringResearchEvent = {
  kind: 'tool'; eventId: string; sessionId: string; timestamp: string;
  studentMessage: string; toolName: string; toolArguments: unknown;
  stateBefore: EngineeringToolBatch['workspace']; stateAfter: EngineeringToolBatch['workspace'];
  solverResult?: unknown; aiResponse: string; succeeded: boolean; error?: string;
} | {
  kind: 'visualization'; eventId: string; sessionId: string; timestamp: string; action: VisualizationAction;
  target?: FBDTarget; force?: FBDForce;
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
  target?: FBDTarget, force?: FBDForce): EngineeringResearchEvent {
  return { kind: 'visualization', eventId: newId(), sessionId, timestamp: now(), action,
    ...(target ? { target } : {}), ...(force ? { force } : {}) };
}
