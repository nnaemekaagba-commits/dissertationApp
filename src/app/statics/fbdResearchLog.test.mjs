import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { addFBDForce, createEmptyFBDState, selectFBDTarget } from './fbdState.ts';
import { createFBDResearchContext, fbdActionForVisualization, fbdToolElement,
  nextFBDResearchSequence } from './researchLog.ts';

const workspace = createSimplySupportedBeamWorkspace();
const before = selectFBDTarget(createEmptyFBDState(workspace),
  { kind: 'member', id: 'AB' }, workspace);
const after = addFBDForce(before, { at: { x: 1, y: 0 }, angle: -90, label: 'P' },
  workspace, 'force-1');

test('FBD construction context includes problem, target, snapshots, modality and message', () => {
  const context = createFBDResearchContext('add_force', before, after, 7,
    'force', 'force-1', 'audio', 'Add a force to my FBD');
  assert.equal(context.problemId, after.sourceStructureKey);
  assert.deepEqual(context.isolatedObject, { kind: 'member', id: 'AB' });
  assert.equal(context.sequence, 7);
  assert.equal(context.inputModality, 'audio');
  assert.equal(context.relatedStudentChatMessage, 'Add a force to my FBD');
  assert.deepEqual(context.stateBefore, before);
  assert.deepEqual(context.stateAfter, after);
  assert.deepEqual(fbdToolElement(before, after, 'fbd_add_force', {}),
    { actionType: 'add_force', elementType: 'force', elementId: 'force-1' });
  assert.deepEqual(fbdToolElement(after, after, 'fbd_edit_force', '{"id":"force-1","label":"P"}'),
    { actionType: 'edit_force', elementType: 'force', elementId: 'force-1' });
  assert.deepEqual(fbdToolElement(after, before, 'fbd_remove_element', '{"kind":"force","id":"force-1"}'),
    { actionType: 'delete_force', elementType: 'force', elementId: 'force-1' });
  assert.equal(fbdActionForVisualization('fbd_element_delete', 'force'), 'delete_force');
  assert.equal(fbdActionForVisualization('fbd_element_drag', 'moment'), 'move_moment');
  for (const [action, expected] of [
    ['fbd_enter', 'enter_fbd_mode'], ['fbd_exit', 'exit_fbd_mode'],
    ['fbd_select', 'select_body'], ['fbd_force_add', 'add_force'],
    ['fbd_moment_add', 'add_moment'], ['fbd_dimension_add', 'add_dimension'],
    ['fbd_angle_add', 'add_angle'], ['fbd_label_add', 'add_label'],
    ['fbd_undo', 'undo'], ['fbd_redo', 'redo'], ['fbd_reset', 'reset_fbd'],
    ['split_view', 'view_change'],
  ]) assert.equal(fbdActionForVisualization(action), expected);
});

test('FBD event sequence survives reload and tracks event creation order', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
  assert.equal(nextFBDResearchSequence(storage, 'session-1'), 1);
  assert.equal(nextFBDResearchSequence(storage, 'session-1'), 2);
  assert.equal(nextFBDResearchSequence(storage, 'session-2'), 1);
  assert.equal(nextFBDResearchSequence(storage, 'session-1'), 3);
});

test('FBD toolbar sends full state transitions for additions, edits, drag and deletion', () => {
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  for (const action of ['fbd_force_add', 'fbd_moment_add', 'fbd_dimension_add',
    'fbd_angle_add', 'fbd_label_add', 'fbd_element_edit', 'fbd_element_delete',
    'fbd_element_drag', 'fbd_element_reposition']) {
    assert.match(panel, new RegExp(`onVisualizationInteraction\\('${action}'`));
  }
  assert.ok((panel.match(/\{ before: fbdState, after: next \}/g) || []).length >= 9);
});
