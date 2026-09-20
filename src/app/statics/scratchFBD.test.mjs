import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { addFBDBody, addFBDJoint, addFBDMember, addFBDForce, addFBDLabel,
  editFBDPrimitive, deleteFBDElement, createEmptyFBDState, hasStudentFBDElements,
  resetStudentFBDElements, parseFBDState, saveFBDState, loadFBDState,
  createFBDHistory, applyFBDChange, undoFBDChange, redoFBDChange } from './fbdState.ts';
import { executeFBDChatToolBatch } from './fbdChatTools.ts';
import { fbdActionForVisualization } from './researchLog.ts';

const workspace = createSimplySupportedBeamWorkspace();
const body = { id: 'Body-1', origin: { x: 0, y: 0 }, width: 4, height: 0.6, label: 'My body' };
const joint = { id: 'Point-1', at: { x: 1, y: 0 }, label: 'J1' };
const member = { id: 'Line-1', start: { x: 0, y: 0 }, end: { x: 3, y: 2 }, label: 'My line' };

test('workspace starts blank and renders no engineering geometry or givens', () => {
  const empty = createEmptyFBDState(workspace);
  assert.deepEqual([empty.bodies, empty.joints, empty.members, empty.forces,
    empty.moments, empty.dimensions, empty.angles, empty.labels],
  [[], [], [], [], [], [], [], []]);
  assert.equal(hasStudentFBDElements(empty), false);
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../FBDReplayCanvas.tsx', import.meta.url), 'utf8');
  assert.match(app, /useState<EngineeringDisplayMode>\('fbd'\)/);
  assert.match(panel, /No diagram yet\. Start building your free-body diagram\./);
  assert.match(panel, /const model = buildFBDModel\(workspace, fbdState/);
  assert.doesNotMatch(panel, /group\.add\(buildGivenFBDOverlay/);
  assert.doesNotMatch(panel, /: buildStructureModel\(workspace, reactionResult\)/);
  assert.doesNotMatch(replay, /workspace\.members/);
});

test('both view panes render the same student elements and joint types persist', () => {
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /DEFAULT_GIVEN_VISIBILITY, false\);/);
  assert.match(panel, /givenVisibility,\s*false, selectedPrimitive\);/);
  assert.match(panel, /aria-label="Joint type"/);
  for (const kind of ['free', 'pin', 'roller', 'fixed']) {
    const state = addFBDJoint(createEmptyFBDState(workspace), { ...joint, kind });
    assert.equal(parseFBDState(JSON.parse(JSON.stringify(state)), workspace).joints[0].kind, kind);
  }
  assert.throws(() => addFBDJoint(createEmptyFBDState(workspace), { ...joint, kind: 'hinged-ish' }));
});

test('FBD opens facing the diagram and restores front view when selected', () => {
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /useState<ViewMode>\('front'\)/);
  assert.match(panel, /displayMode !== 'fbd' \|\| previous === 'fbd'/);
  assert.match(panel, /frameModel\(bounds.center, bounds.span, 'front'\)/);
  assert.match(panel, /new THREE.Vector3\(0, 0, Math.max\(4\.5, model.span \* 1\.7\)\)/);
});

test('clear diagram is visible above canvas and clears only student work', () => {
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  assert.ok(panel.indexOf('Clear Diagram') < panel.indexOf('aria-label={showFbd'));
  assert.match(panel, /aria-label="Confirm Reset FBD"/);
  const state = addFBDJoint(addFBDBody(createEmptyFBDState(workspace), body), joint);
  const original = JSON.stringify(workspace);
  const cleared = resetStudentFBDElements(state);
  assert.equal(hasStudentFBDElements(cleared), false);
  assert.equal(JSON.stringify(workspace), original);
  assert.equal(undoFBDChange(applyFBDChange(createFBDHistory(state), cleared)).present.joints.length, 1);
});

test('first student-created element starts diagram; all geometry and labels are manual FBDState data', () => {
  const before = JSON.stringify(workspace);
  let state = createEmptyFBDState(workspace);
  state = addFBDBody(state, body);
  assert.equal(hasStudentFBDElements(state), true);
  assert.equal(state.bodies[0].label, 'My body');
  state = addFBDJoint(state, joint);
  state = addFBDMember(state, member);
  state = addFBDForce(state, { at: { x: 1, y: 1 }, angle: -90, label: 'P' }, workspace, 'Force-1');
  state = addFBDLabel(state, { at: { x: 2, y: 2 }, text: 'Student note' }, workspace, 'Label-1');
  assert.deepEqual(state.joints[0], joint);
  assert.deepEqual(state.members[0], member);
  assert.equal(state.labels[0].text, 'Student note');
  assert.equal(JSON.stringify(workspace), before);
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  saveFBDState(storage, 'student-1', state, workspace);
  assert.deepEqual(loadFBDState(storage, 'student-1', workspace), state);
  const legacy = { ...state }; delete legacy.bodies; delete legacy.joints; delete legacy.members;
  assert.deepEqual(parseFBDState(legacy, workspace).bodies, []);
});

test('base shapes validate IDs and geometry, and edit, move, delete, reset, undo, redo stay in FBDState', () => {
  let history = createFBDHistory(createEmptyFBDState(workspace));
  const first = addFBDBody(history.present, body);
  history = applyFBDChange(history, first);
  history = applyFBDChange(history, addFBDJoint(history.present, joint));
  history = applyFBDChange(history, addFBDMember(history.present, member));
  assert.throws(() => addFBDJoint(history.present, { ...joint, id: body.id }), /unique/);
  assert.throws(() => addFBDMember(history.present, { ...member, id: 'bad', end: member.start }), /distinct/);
  assert.throws(() => addFBDBody(history.present, { ...body, id: 'bad', width: 0 }), /positive/);
  const changed = editFBDPrimitive(history.present, 'joint', joint.id,
    { ...joint, at: { x: 5, y: 3 }, label: 'Moved J1' });
  history = applyFBDChange(history, changed);
  assert.deepEqual(history.present.joints[0].at, { x: 5, y: 3 });
  history = applyFBDChange(history, deleteFBDElement(history.present, 'member', member.id));
  assert.equal(history.present.members.length, 0);
  const restored = undoFBDChange(history);
  assert.equal(restored.present.members.length, 1);
  assert.equal(redoFBDChange(restored).present.members.length, 0);
  const reset = applyFBDChange(history, resetStudentFBDElements(history.present));
  assert.equal(hasStudentFBDElements(reset.present), false);
  assert.equal(undoFBDChange(reset).present.bodies.length, 1);
});

test('chat modifies primitives only after an explicit request and never invokes the solver', () => {
  const calls = [{ id: 'one', name: 'fbd_add_body', arguments: { x: 0, y: 0, width: 4, height: 1, label: 'Beam body' } },
    { id: 'two', name: 'fbd_add_joint', arguments: { x: 2, y: 0, label: 'J1' } },
    { id: 'three', name: 'fbd_add_member', arguments: { startX: 0, startY: 0,
      endX: 4, endY: 0, label: 'M1' } }];
  let index = 0;
  const batch = executeFBDChatToolBatch(workspace, createEmptyFBDState(workspace), calls,
    'Please add a body, joint, and member to my FBD.', undefined, () => `id-${++index}`);
  assert.deepEqual(batch.results.map((item) => item.success), [true, true, true]);
  assert.equal(batch.state.bodies.length, 1);
  assert.equal(batch.state.joints.length, 1);
  assert.equal(batch.state.members.length, 1);
  const advice = executeFBDChatToolBatch(workspace, batch.state,
    [{ id: 'advice', name: 'fbd_add_joint', arguments: { x: 9, y: 9 } }],
    'What should I consider here?');
  assert.equal(advice.results[0].success, false);
  assert.equal(advice.state, batch.state);
  assert.equal(batch.interactions.some((item) => 'calculation' in item), false);
  assert.equal(fbdActionForVisualization('fbd_body_add'), 'add_body');
  assert.equal(fbdActionForVisualization('fbd_blank_workspace'), 'enter_blank_workspace');
});
