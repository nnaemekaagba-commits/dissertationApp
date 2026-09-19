import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { createEmptyFBDState, selectFBDTarget, createFBDHistory, applyFBDChange, undoFBDChange } from './fbdState.ts';
import { executeFBDChatToolBatch, formatFBDChatToolBatch, explicitlyRequestsFBDModification } from './fbdChatTools.ts';
import { createFBDToolResearchEvents } from './researchLog.ts';

const structure = createSimplySupportedBeamWorkspace();
const initial = selectFBDTarget(createEmptyFBDState(structure), { kind: 'body', id: 'structure' }, structure);
const add = { id: 'call-1', name: 'fbd_add_force', arguments: JSON.stringify({ x: 2, y: 0, angle: -90, label: 'P', magnitude: 10 }) };

test('advice, including missing-element questions, cannot change FBD or its history', () => {
  const originalStructure = JSON.stringify(structure);
  const history = createFBDHistory(initial);
  for (const message of ['What should I consider here?', 'What does a pin support contribute?', 'Am I missing anything?', 'How can I add a force?']) {
    let changes = 0;
    const batch = executeFBDChatToolBatch(structure, history.present, [add], message, () => changes++);
    assert.equal(batch.state, history.present);
    assert.equal(changes, 0);
    assert.equal(batch.results[0].success, false);
    assert.deepEqual(batch.interactions[0].before, batch.interactions[0].after);
    assert.equal(explicitlyRequestsFBDModification(message), false);
    assert.match(formatFBDChatToolBatch(batch), /not completed/);
  }
  assert.equal(history.past.length, 0);
  assert.equal(JSON.stringify(structure), originalStructure);
});

test('explicit FBD edits use validated tools and remain undoable with before/after logs', () => {
  const originalStructure = JSON.stringify(structure);
  let history = createFBDHistory(initial);
  const batch = executeFBDChatToolBatch(structure, history.present, [add], 'Please add a force arrow to my FBD.',
    (next) => { history = applyFBDChange(history, next); }, () => 'chat-force-1');
  assert.equal(batch.results[0].success, true);
  assert.equal(history.present.forces[0].id, 'chat-force-1');
  assert.equal(history.past.length, 1);
  const events = createFBDToolResearchEvents('session-1', 'Please add a force arrow to my FBD.',
    batch, formatFBDChatToolBatch(batch));
  assert.equal(events[0].kind, 'fbd_tool');
  assert.deepEqual(events[0].stateBefore, initial);
  assert.deepEqual(events[0].stateAfter, history.present);
  assert.equal(events[0].succeeded, true);
  history = undoFBDChange(history);
  assert.deepEqual(history.present, initial);
  assert.equal(JSON.stringify(structure), originalStructure);
});

test('invalid and unknown edits fail without false confirmation or lost work', () => {
  for (const argumentsValue of [{ x: 2, y: 0, angle: -90, label: 'P', id: 'injected' },
    '{bad json', { x: 2, y: 0, angle: Number.NaN, label: 'P' }]) {
    const batch = executeFBDChatToolBatch(structure, initial, [{ ...add, arguments: argumentsValue }],
      'Add a force arrow to my FBD.');
    assert.equal(batch.results[0].success, false);
    assert.equal(batch.state, initial);
    assert.match(formatFBDChatToolBatch(batch), /not completed/);
  }
});
