import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyFBDState, engineeringStructureKey } from './fbdState.ts';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { buildFBDReplay, replaySessions, replayStructureIndex } from './fbdReplay.ts';

const structure = createSimplySupportedBeamWorkspace();
const empty = createEmptyFBDState(structure);
const selected = { ...empty, selectedTarget: { kind: 'member', id: 'AB' } };
const withForce = { ...selected, forces: [{ id: 'force-1', at: { x: 2, y: 0 }, angle: -90, label: 'P' }] };
const event = (id, sequence, actionType, before, after, studentMessage = null) => ({
  kind: 'visualization', eventId: id, sessionId: 'student-session',
  timestamp: '2026-09-20T12:00:00.000Z', action: 'fbd',
  fbdResearch: { problemId: after.sourceStructureKey, isolatedObject: after.selectedTarget,
    actionType, elementType: actionType === 'add_force' ? 'force' : null,
    elementId: actionType === 'add_force' ? 'force-1' : null,
    stateBefore: before, stateAfter: after, inputModality: studentMessage ? 'audio' : null,
    relatedStudentChatMessage: studentMessage, sequence },
});

test('replay reconstructs ordered snapshots and message without changing records', () => {
  const second = event('second', 2, 'add_force', selected, withForce, 'Add a force');
  const first = event('first', 1, 'select_body', empty, selected);
  const input = [second, first, { ...second, eventId: 'other', sessionId: 'other-session' }];
  const original = JSON.stringify(input);
  const steps = buildFBDReplay(input, 'student-session');
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((step) => step.actionType), ['Initial FBD', 'select_body', 'add_force']);
  assert.deepEqual(steps[0].state, empty);
  assert.deepEqual(steps[1].state, selected);
  assert.deepEqual(steps[2].state, withForce);
  assert.equal(steps[2].studentMessage, 'Add a force');
  assert.equal(steps[2].inputModality, 'audio');
  steps[2].state.forces[0].label = 'Changed only in replay';
  assert.equal(JSON.stringify(input), original);
  assert.deepEqual(replaySessions(input), ['student-session', 'other-session']);
});

test('legacy FBD snapshots replay and structure geometry is matched by problem key', () => {
  const legacy = { kind: 'fbd_tool', eventId: 'legacy', sessionId: 'legacy-session',
    timestamp: '2026-09-19T12:00:00.000Z', studentMessage: 'Add force',
    toolName: 'fbd_add_force', toolArguments: {}, stateBefore: selected,
    stateAfter: withForce, aiResponse: 'Added', succeeded: true };
  const steps = buildFBDReplay([legacy], 'legacy-session');
  assert.equal(steps.length, 2);
  assert.equal(steps[1].studentMessage, 'Add force');
  assert.deepEqual(steps[1].state.forces, withForce.forces);
  const index = replayStructureIndex([]);
  assert.deepEqual(index.get(engineeringStructureKey(structure)), structure);
});
