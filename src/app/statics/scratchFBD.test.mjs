import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { addFBDBody, addFBDJoint, addFBDMember, addFBDForce, addFBDLabel,
  fbdBodyCorners, fbdBodyEndpointLabelPositions, fbdMemberEndFromAngle, fbdEndpointLabels,
  fbdMemberEndpointLabelPositions,
  editFBDPrimitive, deleteFBDElement, createEmptyFBDState, hasStudentFBDElements,
  resetStudentFBDElements, parseFBDState, saveFBDState, loadFBDState,
  createFBDHistory, applyFBDChange, undoFBDChange, redoFBDChange } from './fbdState.ts';
import { executeFBDChatToolBatch } from './fbdChatTools.ts';
import { fbdActionForVisualization } from './researchLog.ts';
import { fbdJointSymbol } from './fbdJointSymbol.ts';
import { fbdGridLineConflicts, fbdGridReading, fbdGridSpec } from './fbdGrid.ts';

const workspace = createSimplySupportedBeamWorkspace();
const body = { id: 'Body-1', origin: { x: 0, y: 0 }, width: 4, height: 0.6, label: 'My body' };
const joint = { id: 'Point-1', at: { x: 1, y: 0 }, label: 'J1' };
const member = { id: 'Line-1', start: { x: 0, y: 0 }, end: { x: 3, y: 2 }, label: 'My line' };

test('adaptive gridlines include numeric coordinate readings and workspace units', () => {
  const grid = fbdGridSpec({ x: 2, y: 1 }, 4);
  assert.ok(grid.xValues.length >= 8 && grid.xValues.length <= 20);
  assert.ok(grid.yValues.length >= 8 && grid.yValues.length <= 20);
  assert.ok(grid.xValues.includes(0));
  assert.equal(fbdGridReading(0), '0');
  assert.equal(fbdGridReading(1.5), '1.5');
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../FBDReplayCanvas.tsx', import.meta.url), 'utf8');
  assert.match(panel, /fbdGridSpec\(center, span\)/);
  assert.match(panel, /x \(\$\{workspace\.units\.length\}\)/);
  assert.match(replay, /aria-label="Coordinate grid"/);
  assert.match(replay, /workspace\?\.units\.length/);
});

test('member endpoint letters sit beyond the exact ends for every orientation', () => {
  const horizontal = fbdMemberEndpointLabelPositions({ ...member,
    start: { x: 0, y: 0 }, end: { x: 4, y: 0 } }, 0.5);
  assert.deepEqual(horizontal, [{ x: -0.5, y: 0 }, { x: 4.5, y: 0 }]);
  const vertical = fbdMemberEndpointLabelPositions({ ...member,
    start: { x: 0, y: 0 }, end: { x: 0, y: 4 } }, 0.5);
  assert.deepEqual(vertical, [{ x: 0, y: -0.5 }, { x: 0, y: 4.5 }]);
  const inclined = fbdMemberEndpointLabelPositions({ ...member,
    start: { x: 0, y: 0 }, end: { x: 3, y: 4 } }, 0.5);
  assert.deepEqual(inclined, [{ x: -0.3, y: -0.4 }, { x: 3.3, y: 4.4 }]);
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../FBDReplayCanvas.tsx', import.meta.url), 'utf8');
  assert.match(panel, /fbdMemberEndpointLabelPositions\(member/);
  assert.match(replay, /fbdMemberEndpointLabelPositions\(member/);
});

test('body tilt rotates corners; member tilt sets endpoint; force already stores direction angle', () => {
  const tilted = addFBDBody(createEmptyFBDState(workspace), { ...body, angle: 90 });
  const corners = fbdBodyCorners(tilted.bodies[0]);
  assert.ok(Math.abs(corners[1].x) < 1e-9);
  assert.ok(Math.abs(corners[1].y - 4) < 1e-9);
  assert.equal(parseFBDState(JSON.parse(JSON.stringify(tilted)), workspace).bodies[0].angle, 90);
  assert.throws(() => addFBDBody(createEmptyFBDState(workspace), { ...body, angle: Infinity }));
  const end = fbdMemberEndFromAngle({ x: 0, y: 0 }, 4, 30);
  assert.ok(Math.abs(end.x - 2 * Math.sqrt(3)) < 1e-9);
  assert.ok(Math.abs(end.y - 2) < 1e-9);
  const forceState = addFBDForce(createEmptyFBDState(workspace),
    { at: { x: 1, y: 0 }, angle: 30, label: 'P' }, workspace, 'P1');
  assert.equal(forceState.forces[0].angle, 30);
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../FBDReplayCanvas.tsx', import.meta.url), 'utf8');
  assert.match(panel, /Body tilt \(degrees from \+X\)/);
  assert.match(panel, /Member tilt \(degrees from \+X\)/);
  assert.match(panel, /Force tilt \/ direction \(degrees from \+X\)/);
  assert.match(replay, /fbdBodyCorners\(body\)/);
});

test('explicit chat tilt uses the same FBD geometry without solving', () => {
  const calls = [
    { id: 'body', name: 'fbd_add_body', arguments: { x: 0, y: 0, width: 4, height: 0.6, angle: 20 } },
    { id: 'member', name: 'fbd_add_member', arguments: { startX: 0, startY: 0, length: 4, angle: 30 } },
  ];
  let index = 0;
  const result = executeFBDChatToolBatch(workspace, createEmptyFBDState(workspace), calls,
    'Draw a body at 20 degrees and member at 30 degrees.', undefined, () => `tilt-${++index}`);
  assert.deepEqual(result.results.map((item) => item.success), [true, true]);
  assert.equal(result.state.bodies[0].angle, 20);
  assert.ok(Math.abs(result.state.members[0].end.y - 2) < 1e-9);
});

test('each joint kind has its own drafting geometry in the live canvas and replay', () => {
  const free = fbdJointSymbol('free');
  const pin = fbdJointSymbol('pin');
  const roller = fbdJointSymbol('roller');
  const fixed = fbdJointSymbol('fixed');
  assert.equal(free.strokes.length, 0);
  assert.equal(free.circles.length, 1);
  assert.equal(pin.circles.length, 1);
  assert.ok(pin.strokes.length >= 4);
  assert.equal(roller.circles.filter((item) => !item.filled).length, 2);
  assert.ok(roller.circles.length > pin.circles.length);
  assert.equal(fixed.circles.length, 1);
  assert.ok(fixed.strokes.length >= 4);
  assert.notDeepEqual(pin, roller);
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../FBDReplayCanvas.tsx', import.meta.url), 'utf8');
  assert.match(panel, /fbdJointSymbol\(node\.kind\)/);
  assert.match(replay, /fbdJointSymbol\(node\.kind\)/);
});

test('two-letter body and member names display their endpoint labels without creating new elements', () => {
  assert.deepEqual(fbdEndpointLabels('AD'), ['A', 'D']);
  assert.deepEqual(fbdEndpointLabels('BC'), ['B', 'C']);
  assert.equal(fbdEndpointLabels('Member_12'), null);
  const state = addFBDMember(addFBDBody(createEmptyFBDState(workspace),
    { ...body, label: 'AD' }), { ...member, label: 'BC' });
  assert.equal(state.labels.length, 0);
  assert.equal(state.bodies[0].label, 'AD');
  assert.equal(state.members[0].label, 'BC');
  const idOnly = addFBDMember(addFBDBody(createEmptyFBDState(workspace),
    { ...body, id: 'AD', label: undefined }), { ...member, id: 'BC', label: undefined });
  assert.deepEqual(fbdEndpointLabels(idOnly.bodies[0].label || idOnly.bodies[0].id), ['A', 'D']);
  assert.deepEqual(fbdEndpointLabels(idOnly.members[0].label || idOnly.members[0].id), ['B', 'C']);
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../FBDReplayCanvas.tsx', import.meta.url), 'utf8');
  assert.match(panel, /fbdEndpointLabels\(body\.label \|\| body\.id\)/);
  assert.match(panel, /fbdEndpointLabels\(member\.label \|\| member\.id\)/);
  assert.match(replay, /fbdEndpointLabels\(body\.label \|\| body\.id\)/);
  assert.match(replay, /fbdEndpointLabels\(member\.label \|\| member\.id\)/);
});

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

test('clear and delete controls explain empty or unselected states instead of disabling', () => {
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /The diagram is already empty\./);
  assert.match(panel, /Select an element in the diagram or from the list below to delete it\./);
  assert.match(panel, /if \(selectedElement\) deleteSelected\(\);\s*else if \(selectedPrimitiveElement\) deleteSelectedPrimitive\(\);/);
  assert.doesNotMatch(panel, /disabled=\{!hasStudentFBDElements\(fbdState\)\}/);
});

test('rotated body endpoint letters are centered and outside both longitudinal ends', () => {
  const horizontal = fbdBodyEndpointLabelPositions({ ...body, origin: { x: 0, y: 0 },
    width: 4, height: 0.6, angle: 0 }, 0.5);
  assert.deepEqual(horizontal, [{ x: -0.5, y: 0.3 }, { x: 4.5, y: 0.3 }]);
  const vertical = fbdBodyEndpointLabelPositions({ ...body, origin: { x: 0, y: 0 },
    width: 4, height: 0.6, angle: 90 }, 0.5);
  assert.ok(Math.abs(vertical[0].x + 0.3) < 1e-9);
  assert.ok(Math.abs(vertical[0].y + 0.5) < 1e-9);
  assert.ok(Math.abs(vertical[1].x + 0.3) < 1e-9);
  assert.ok(Math.abs(vertical[1].y - 4.5) < 1e-9);
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../FBDReplayCanvas.tsx', import.meta.url), 'utf8');
  assert.match(panel, /fbdBodyEndpointLabelPositions\(body/);
  assert.match(replay, /fbdBodyEndpointLabelPositions\(body/);
});

test('body fill masks background gridlines without hiding its outline', () => {
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../FBDReplayCanvas.tsx', import.meta.url), 'utf8');
  assert.match(panel, /new THREE\.ShapeGeometry\(maskShape\)/);
  assert.match(panel, /color: 0xf8fafc/);
  assert.match(panel, /mask\.position\.z = -0\.08/);
  assert.match(replay, /fill="#f8fafc" stroke="#059669"/);
});

test('gridlines that coincide with member or body edges are omitted', () => {
  const segments = [
    { start: { x: 0, y: 0 }, end: { x: 0, y: 4 } },
    { start: { x: -1, y: 2 }, end: { x: 3, y: 2 } },
  ];
  assert.equal(fbdGridLineConflicts('x', 0, segments, 0.01), true);
  assert.equal(fbdGridLineConflicts('y', 2, segments, 0.01), true);
  assert.equal(fbdGridLineConflicts('x', 1, segments, 0.01), false);
  assert.equal(fbdGridLineConflicts('y', 1, segments, 0.01), false);
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../FBDReplayCanvas.tsx', import.meta.url), 'utf8');
  assert.match(panel, /fbdGridLineConflicts\('x', x, geometrySegments/);
  assert.match(replay, /fbdGridLineConflicts\('x', x, geometrySegments/);
});

test('grid coordinate readings use large high-contrast text', () => {
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../FBDReplayCanvas.tsx', import.meta.url), 'utf8');
  assert.match(panel, /fbdGridReading\(x\), '#334155', 0\.4/);
  assert.match(panel, /strokeText\(text, 128, 48, 242\)/);
  assert.match(panel, /x \(\$\{workspace\.units\.length\}\).*'#1e293b', 0\.44/);
  assert.match(replay, /fill="#334155" fontSize="14"/);
  assert.match(replay, /fontWeight="700" stroke="#f8fafc"/);
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
