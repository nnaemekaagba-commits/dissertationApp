import { createSimplySupportedBeamWorkspace, type StaticsWorkspace } from './model.ts';
import { engineeringStructureKey, type FBDState } from './fbdState.ts';
import type { EngineeringResearchEvent } from './researchLog.ts';

export type FBDReplayStep = {
  eventId: string | null; sessionId: string; timestamp: string | null;
  actionType: string; elementType: string | null; elementId: string | null;
  state: FBDState; problemId: string; studentMessage: string | null;
  inputModality: 'text' | 'audio' | null;
};

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function snapshots(event: EngineeringResearchEvent) {
  if (event.kind === 'tool') return null;
  if (event.fbdResearch) return {
    before: event.fbdResearch.stateBefore, after: event.fbdResearch.stateAfter,
    actionType: event.fbdResearch.actionType,
    elementType: event.fbdResearch.elementType,
    elementId: event.fbdResearch.elementId,
    studentMessage: event.fbdResearch.relatedStudentChatMessage,
    inputModality: event.fbdResearch.inputModality,
    sequence: event.fbdResearch.sequence,
  };
  if (event.kind === 'fbd_tool') return { before: event.stateBefore, after: event.stateAfter,
    actionType: event.toolName, elementType: null, elementId: null,
    studentMessage: event.studentMessage, inputModality: null, sequence: 0 };
  if (event.kind === 'fbd_check') return { before: event.fbdState, after: event.fbdState,
    actionType: 'request_fbd_check', elementType: null, elementId: null,
    studentMessage: event.studentMessage, inputModality: null, sequence: 0 };
  if (event.fbdBefore && event.fbdAfter) return { before: event.fbdBefore, after: event.fbdAfter,
    actionType: event.action, elementType: event.elementKind ?? null,
    elementId: event.elementId ?? null, studentMessage: null,
    inputModality: null, sequence: 0 };
  return null;
}

/** Uses persisted snapshots, never executes the original actions or mutates source events. */
export function buildFBDReplay(events: EngineeringResearchEvent[], sessionId: string): FBDReplayStep[] {
  const ordered = events.filter((event) => event.sessionId === sessionId)
    .map((event) => ({ event, snapshot: snapshots(event) }))
    .filter((entry): entry is { event: EngineeringResearchEvent;
      snapshot: NonNullable<ReturnType<typeof snapshots>> } => entry.snapshot !== null)
    .sort((a, b) => a.event.timestamp.localeCompare(b.event.timestamp) ||
      a.snapshot.sequence - b.snapshot.sequence || a.event.eventId.localeCompare(b.event.eventId));
  if (!ordered.length) return [];
  const initial = copy(ordered[0].snapshot.before);
  return [
    { eventId: null, sessionId, timestamp: null, actionType: 'Initial FBD',
      elementType: null, elementId: null, state: initial,
      problemId: initial.sourceStructureKey, studentMessage: null, inputModality: null },
    ...ordered.map(({ event, snapshot }) => {
      const state = copy(snapshot.after);
      return { eventId: event.eventId, sessionId, timestamp: event.timestamp,
        actionType: snapshot.actionType, elementType: snapshot.elementType,
        elementId: snapshot.elementId, state, problemId: state.sourceStructureKey,
        studentMessage: snapshot.studentMessage,
        inputModality: snapshot.inputModality };
    }),
  ];
}

export function replaySessions(events: EngineeringResearchEvent[]): string[] {
  return [...new Set(events.filter((event) => snapshots(event)).map((event) => event.sessionId))];
}

export function replayStructureIndex(events: EngineeringResearchEvent[]): Map<string, StaticsWorkspace> {
  const index = new Map<string, StaticsWorkspace>();
  const starting = createSimplySupportedBeamWorkspace();
  index.set(engineeringStructureKey(starting), copy(starting));
  for (const event of events) {
    if (event.kind !== 'tool') continue;
    for (const state of [event.stateBefore, event.stateAfter])
      index.set(engineeringStructureKey(state), copy(state));
  }
  return index;
}
