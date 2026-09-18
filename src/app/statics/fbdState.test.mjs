import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { createEmptyFBDState, engineeringStructureKey, fbdStorageKey, loadFBDState,
  saveFBDState, selectFBDTarget, addFBDForce, addFBDMoment, addFBDDimension, addFBDAngle,
  addFBDLabel, moveFBDLabel,
  editFBDForce, editFBDMoment, editFBDDimension, editFBDAngle, editFBDLabel,
  deleteFBDElement, getFBDElement,
  repositionFBDLabel, moveFBDForceApplication,
  visibleReactions, createFBDHistory, applyFBDChange,
  undoFBDChange, redoFBDChange } from './fbdState.ts';
import { buildFBDForceArrow } from './fbdForceScene.ts';
import { buildFBDMomentArrow, momentArcPoints } from './fbdMomentScene.ts';
import { buildFBDDimensionLines, dimensionLayout } from './fbdDimensionScene.ts';
import { angleArcLayout, buildFBDAngleArc } from './fbdAngleScene.ts';
import { createVisualizationResearchEvent } from './researchLog.ts';

const workspace = createSimplySupportedBeamWorkspace();

test('Build FBD Mode starts empty and leaves EngineeringState unchanged', () => {
  const before = JSON.stringify(workspace);
  const fbd = createEmptyFBDState(workspace);
  assert.deepEqual([fbd.forces, fbd.moments, fbd.dimensions, fbd.angles, fbd.labels], [[], [], [], [], []]);
  assert.equal(fbd.selectedTarget, null);
  assert.equal(fbd.sourceStructureKey, engineeringStructureKey(workspace));
  assert.equal(JSON.stringify(workspace), before);
});

test('student selects a body, member, or joint without creating FBD elements', () => {
  const state = createEmptyFBDState(workspace);
  for (const target of [{ kind: 'body', id: 'structure' }, { kind: 'member', id: 'AB' }, { kind: 'joint', id: 'A' }]) {
    const next = selectFBDTarget(state, target, workspace);
    assert.deepEqual(next.selectedTarget, target);
    assert.deepEqual(next.forces, []);
  }
  assert.throws(() => selectFBDTarget(state, { kind: 'member', id: 'unknown' }, workspace));
});

test('FBDState survives Structure to FBD switching and a storage reload', () => {
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'member', id: 'AB' }, workspace);
  const studentWork = { ...selected, forces: [{ id: 'student-force-1', at: { x: 1, y: 0 }, angle: 90, label: 'F' }] };
  saveFBDState(storage, 'student-1', studentWork, workspace);
  assert.deepEqual(loadFBDState(storage, 'student-1', workspace), studentWork);
  assert.ok(records.has(fbdStorageKey('student-1')));
  assert.equal(JSON.stringify(workspace), JSON.stringify(createSimplySupportedBeamWorkspace()));
});

test('selection supports undo, redo, and reset without changing EngineeringState', () => {
  const original = createEmptyFBDState(workspace);
  const selected = selectFBDTarget(original, { kind: 'joint', id: 'A' }, workspace);
  const changed = applyFBDChange(createFBDHistory(original), selected);
  assert.deepEqual(undoFBDChange(changed).present, original);
  assert.deepEqual(redoFBDChange(undoFBDChange(changed)).present, selected);
  assert.deepEqual(applyFBDChange(changed, createEmptyFBDState(workspace)).present.selectedTarget, null);
  assert.equal(workspace.nodes[0].id, 'A');
});

test('multi-step FBD history undoes and redoes adds, edits, deletion, and repositioning', () => {
  const engineeringBefore = JSON.stringify(workspace);
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const changes = [
    (state) => addFBDForce(state, { at: { x: 1, y: 0 }, angle: -90, label: 'P', magnitude: 10 }, workspace, 'force-1'),
    (state) => addFBDMoment(state, { at: { x: 2, y: 0 }, clockwise: true, label: 'M' }, workspace, 'moment-1'),
    (state) => addFBDDimension(state, { start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, label: '2 m' }, workspace, 'dimension-1'),
    (state) => addFBDAngle(state, { vertex: { x: 0, y: 0 }, from: { x: 1, y: 0 },
      to: { x: 0, y: 1 }, label: '30°' }, workspace, 'angle-1'),
    (state) => addFBDLabel(state, { at: { x: 1, y: 1 }, text: 'Given' }, workspace, 'label-1'),
    (state) => editFBDForce(state, 'force-1', { at: { x: 1, y: 0 }, angle: 45, label: 'Q' }, workspace),
    (state) => deleteFBDElement(state, 'moment', 'moment-1'),
    (state) => repositionFBDLabel(state, 'dimension', 'dimension-1', { x: 3, y: 2 }),
    (state) => moveFBDForceApplication(state, 'force-1', { x: 2, y: 0 }, workspace),
  ];
  let history = createFBDHistory(selected);
  const snapshots = [selected];
  for (const change of changes) {
    history = applyFBDChange(history, change(history.present));
    snapshots.push(history.present);
  }
  assert.equal(history.past.length, changes.length);
  assert.deepEqual(history.present.forces[0].at, { x: 2, y: 0 });
  assert.deepEqual(history.present.dimensions[0].labelPosition, { x: 3, y: 2 });
  for (let index = changes.length - 1; index >= 0; index--) {
    const before = history.present;
    history = undoFBDChange(history);
    assert.deepEqual(history.present, snapshots[index]);
    assert.equal(history.future[0], before);
  }
  assert.equal(history.past.length, 0);
  assert.equal(history.future.length, changes.length);
  const unchanged = undoFBDChange(history);
  assert.deepEqual(unchanged, history);
  for (let index = 1; index <= changes.length; index++) {
    history = redoFBDChange(history);
    assert.deepEqual(history.present, snapshots[index]);
  }
  assert.equal(history.future.length, 0);
  assert.deepEqual(redoFBDChange(history), history);
  assert.equal(JSON.stringify(workspace), engineeringBefore);
  let solverCalls = 0;
  assert.equal(visibleReactions(true, workspace, () => { solverCalls++; return {}; }).result, null);
  assert.equal(solverCalls, 0);
});

test('a new FBD action after undo clears redo, and history logging records exact snapshots', () => {
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const first = applyFBDChange(createFBDHistory(selected), addFBDLabel(selected,
    { at: { x: 1, y: 0 }, text: 'A' }, workspace, 'label-1'));
  const second = applyFBDChange(first, addFBDForce(first.present,
    { at: { x: 2, y: 0 }, angle: -90, label: 'P' }, workspace, 'force-1'));
  const undone = undoFBDChange(second);
  const event = createVisualizationResearchEvent('session-1', 'fbd_undo',
    () => 'event-1', () => '2026-09-18T12:00:00.000Z', undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, { before: second.present, after: undone.present });
  assert.deepEqual(event.fbdBefore, second.present);
  assert.deepEqual(event.fbdAfter, undone.present);
  assert.equal(event.sessionId, 'session-1');
  const revised = applyFBDChange(undone, editFBDLabel(undone.present, 'label-1',
    { at: { x: 2, y: 1 }, text: 'B' }, workspace));
  assert.equal(revised.future.length, 0);
  assert.deepEqual(redoFBDChange(revised), revised);
  assert.deepEqual(revised.present.labels[0].text, 'B');
  assert.deepEqual(revised.present.forces, []);
});

test('entering Build FBD Mode never invokes the solver', () => {
  let calls = 0;
  const solver = () => { calls += 1; return { reactions: [] }; };
  assert.deepEqual(visibleReactions(true, workspace, solver), { result: null, error: '' });
  assert.equal(calls, 0);
  visibleReactions(false, workspace, solver);
  assert.equal(calls, 1);
});

test('FBD mode uses the existing visualization component and same canvas', () => {
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /onFbdChange\(!showFbd\)/);
  assert.match(panel, /ref=\{containerRef\}/);
  assert.match(panel, /FBD construction toolbar/);
  assert.doesNotMatch(panel, /navigate\(|window\.open\(/);
  assert.match(panel, /flex h-full max-h-full min-h-0 flex-col overflow-hidden/);
  assert.match(panel, /ref=\{containerRef\} className="relative min-h-0 basis-0 flex-1/);
  assert.match(panel, /max-h-\[45%\] min-h-0 shrink-0 overflow-y-auto[^\n]+aria-label="FBD construction toolbar"/);
  assert.match(panel, /renderer\.setSize\(width, height\)/);
  assert.doesNotMatch(panel, /renderer\.setSize\(width, height, false\)/);
});

test('mode changes and selected target produce research log events', () => {
  const id = () => 'event-1';
  const now = () => '2026-09-17T12:00:00.000Z';
  assert.equal(createVisualizationResearchEvent('session-1', 'fbd_enter', id, now).action, 'fbd_enter');
  assert.equal(createVisualizationResearchEvent('session-1', 'fbd_exit', id, now).action, 'fbd_exit');
  assert.deepEqual(createVisualizationResearchEvent('session-1', 'fbd_select', id, now,
    { kind: 'joint', id: 'A' }).target, { kind: 'joint', id: 'A' });
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /recordVisualizationInteraction\(showFbd \? 'fbd_enter' : 'fbd_exit'\)/);
});

test('student force is stored only in FBDState and survives a storage reload', () => {
  const before = JSON.stringify(workspace);
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'member', id: 'AB' }, workspace);
  const added = addFBDForce(selected, { at: { x: 1.5, y: 0 }, angle: -90,
    label: 'P', magnitude: 10 }, workspace, 'force-1');
  assert.deepEqual(added.forces, [{ id: 'force-1', at: { x: 1.5, y: 0 },
    angle: -90, label: 'P', magnitude: 10 }]);
  assert.equal(JSON.stringify(workspace), before);
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  saveFBDState(storage, 'force-student', added, workspace);
  assert.deepEqual(loadFBDState(storage, 'force-student', workspace), added);
});

test('force input accepts unknown magnitude and rejects invalid or duplicate data', () => {
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'joint', id: 'A' }, workspace);
  const input = { at: { x: 0, y: 0 }, angle: 45, label: 'T' };
  const added = addFBDForce(selected, input, workspace, 'force-1');
  assert.equal(added.forces[0].magnitude, undefined);
  assert.throws(() => addFBDForce(added, input, workspace, 'force-1'), /unique/);
  assert.throws(() => addFBDForce(selected, { ...input, angle: Infinity }, workspace, 'force-2'), /valid point/);
  assert.throws(() => addFBDForce(selected, { ...input, magnitude: -1 }, workspace, 'force-2'), /valid point/);
  assert.throws(() => addFBDForce(createEmptyFBDState(workspace), input, workspace, 'force-2'), /Select/);
});

test('Three.js force arrow starts at the chosen point and follows the chosen angle', () => {
  const arrow = buildFBDForceArrow({ id: 'force-1', at: { x: 1, y: 2 }, angle: 90, label: 'F' }, 4, true);
  assert.equal(arrow.userData.fbdForceId, 'force-1');
  assert.equal(arrow.children.length, 1);
  assert.equal(arrow.children[0].position.x, 1);
  assert.equal(arrow.children[0].position.y, 2);
  const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.children[0].quaternion);
  assert.ok(Math.abs(direction.x) < 1e-9);
  assert.ok(Math.abs(direction.y - 1) < 1e-9);
  assert.ok(arrow.children[0].children.length >= 2);
});

test('adding a force does not invoke the solver in FBD mode', () => {
  let calls = 0;
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const added = addFBDForce(selected, { at: { x: 2, y: 0 }, angle: -90, label: 'P' }, workspace, 'force-1');
  const result = visibleReactions(true, workspace, () => { calls += 1; return {}; });
  assert.equal(calls, 0);
  assert.equal(result.result, null);
  assert.equal(added.forces.length, 1);
});

test('force addition log includes point, label, angle, magnitude, session, and timestamp', () => {
  const force = { id: 'force-1', at: { x: 2, y: 0 }, angle: -90, label: 'P', magnitude: 10 };
  const event = createVisualizationResearchEvent('session-1', 'fbd_force_add',
    () => 'event-1', () => '2026-09-17T12:00:00.000Z', undefined, force);
  assert.equal(event.sessionId, 'session-1');
  assert.equal(event.timestamp, '2026-09-17T12:00:00.000Z');
  assert.deepEqual(event.force, force);
});

test('clockwise and counterclockwise moments are student data, persist, and support unknown magnitude', () => {
  const engineeringBefore = JSON.stringify(workspace);
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'member', id: 'AB' }, workspace);
  const clockwise = addFBDMoment(selected, { at: { x: 1, y: 0 }, clockwise: true,
    label: 'M_A', magnitude: 6 }, workspace, 'moment-cw');
  const both = addFBDMoment(clockwise, { at: { x: 3, y: 0 }, clockwise: false,
    label: 'M_B' }, workspace, 'moment-ccw');
  assert.deepEqual(both.moments.map((moment) => moment.clockwise), [true, false]);
  assert.equal(both.moments[0].magnitude, 6);
  assert.equal(both.moments[1].magnitude, undefined);
  assert.equal(JSON.stringify(workspace), engineeringBefore);
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  saveFBDState(storage, 'moment-student', both, workspace);
  assert.deepEqual(loadFBDState(storage, 'moment-student', workspace), both);
});

test('moment creation validates point, direction, label, magnitude, and unique ID', () => {
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'joint', id: 'A' }, workspace);
  const input = { at: { x: 0, y: 0 }, clockwise: true, label: 'M' };
  const added = addFBDMoment(selected, input, workspace, 'moment-1');
  assert.throws(() => addFBDMoment(added, input, workspace, 'moment-1'), /unique/);
  assert.throws(() => addFBDMoment(selected, { ...input, clockwise: 'yes' }, workspace, 'moment-2'), /valid point/);
  assert.throws(() => addFBDMoment(selected, { ...input, at: { x: Infinity, y: 0 } }, workspace, 'moment-2'), /valid point/);
  assert.throws(() => addFBDMoment(selected, { ...input, magnitude: -2 }, workspace, 'moment-2'), /valid point/);
  assert.throws(() => addFBDMoment(createEmptyFBDState(workspace), input, workspace, 'moment-2'), /Select/);
});

test('curved moment arrows wind clockwise and counterclockwise around their application points', () => {
  for (const clockwise of [true, false]) {
    const moment = { id: clockwise ? 'cw' : 'ccw', at: { x: 1, y: 2 }, clockwise, label: 'M' };
    const points = momentArcPoints(moment, 4);
    const winding = points[0].x * points[1].y - points[0].y * points[1].x;
    assert.equal(Math.sign(winding), clockwise ? -1 : 1);
    const arrow = buildFBDMomentArrow(moment, 4, true);
    assert.equal(arrow.userData.fbdMomentId, moment.id);
    assert.deepEqual([arrow.position.x, arrow.position.y], [1, 2]);
    assert.equal(arrow.children.length, 2);
    assert.ok(arrow.children[1].isMesh);
  }
});

test('adding moments leaves the FBD solver path inactive and logs chosen values', () => {
  let calls = 0;
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const added = addFBDMoment(selected, { at: { x: 2, y: 0 }, clockwise: false,
    label: 'C' }, workspace, 'moment-1');
  assert.equal(visibleReactions(true, workspace, () => { calls += 1; return {}; }).result, null);
  assert.equal(calls, 0);
  const event = createVisualizationResearchEvent('session-1', 'fbd_moment_add',
    () => 'event-1', () => '2026-09-17T12:00:00.000Z', undefined, undefined, added.moments[0]);
  assert.equal(event.sessionId, 'session-1');
  assert.equal(event.timestamp, '2026-09-17T12:00:00.000Z');
  assert.deepEqual(event.moment, added.moments[0]);
});

test('student dimension keeps exact text and endpoints in FBDState across reload', () => {
  const before = JSON.stringify(workspace);
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'member', id: 'AB' }, workspace);
  const added = addFBDDimension(selected, { start: { x: 0, y: 0 }, end: { x: 2, y: 0 },
    label: '2 m' }, workspace, 'dimension-1');
  assert.deepEqual(added.dimensions, [{ id: 'dimension-1', start: { x: 0, y: 0 },
    end: { x: 2, y: 0 }, label: '2 m' }]);
  assert.equal(JSON.stringify(workspace), before);
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  saveFBDState(storage, 'dimension-student', added, workspace);
  assert.deepEqual(loadFBDState(storage, 'dimension-student', workspace), added);
});

test('dimension creation rejects missing text, duplicate IDs, and coincident or invalid points', () => {
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const input = { start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, label: '4 ft' };
  const added = addFBDDimension(selected, input, workspace, 'dimension-1');
  assert.throws(() => addFBDDimension(added, input, workspace, 'dimension-1'), /unique/);
  assert.throws(() => addFBDDimension(selected, { ...input, label: ' ' }, workspace, 'dimension-2'), /distinct/);
  assert.throws(() => addFBDDimension(selected, { ...input, end: input.start }, workspace, 'dimension-2'), /distinct/);
  assert.throws(() => addFBDDimension(selected, { ...input, end: { x: Infinity, y: 0 } }, workspace, 'dimension-2'), /distinct/);
  assert.throws(() => addFBDDimension(createEmptyFBDState(workspace), input, workspace, 'dimension-2'), /Select/);
});

test('dimension scene renders line, two extension lines, ticks, and student text position', () => {
  const dimension = { id: 'dimension-1', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, label: '4 ft' };
  const layout = dimensionLayout(dimension, 4);
  assert.deepEqual([layout.dimensionStart.x, layout.dimensionEnd.x], [0, 4]);
  assert.ok(layout.dimensionStart.y > 0);
  assert.ok(layout.labelPosition.y > layout.dimensionStart.y);
  const group = buildFBDDimensionLines(dimension, 4, true);
  assert.equal(group.userData.fbdDimensionId, 'dimension-1');
  assert.equal(group.children.length, 5);
  const [main, startExtension, endExtension] = group.children;
  assert.equal(main.type, 'Line');
  assert.equal(startExtension.type, 'Line');
  assert.equal(endExtension.type, 'Line');
  assert.equal(startExtension.geometry.getAttribute('position').getY(0), 0);
  assert.equal(endExtension.geometry.getAttribute('position').getX(0), 4);
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /textSprite\(dimension\.label \|\| ''/);
  assert.match(panel, /dimensionLayout\(dimension, span\)\.labelPosition/);
});

test('dimension addition does not calculate a value or invoke the solver and is logged', () => {
  let calls = 0;
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const added = addFBDDimension(selected, { start: { x: 0, y: 0 }, end: { x: 1, y: 0 },
    label: '4 ft' }, workspace, 'dimension-1');
  assert.equal(added.dimensions[0].label, '4 ft');
  assert.equal(visibleReactions(true, workspace, () => { calls += 1; return {}; }).result, null);
  assert.equal(calls, 0);
  const event = createVisualizationResearchEvent('session-1', 'fbd_dimension_add',
    () => 'event-1', () => '2026-09-18T12:00:00.000Z', undefined, undefined, undefined, added.dimensions[0]);
  assert.equal(event.sessionId, 'session-1');
  assert.equal(event.timestamp, '2026-09-18T12:00:00.000Z');
  assert.deepEqual(event.dimension, added.dimensions[0]);
});

test('student angle persists exact text and chosen references without changing EngineeringState', () => {
  const before = JSON.stringify(workspace);
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'member', id: 'AB' }, workspace);
  const input = { vertex: { x: 1, y: 0 }, from: { x: 2, y: 0 },
    to: { x: 1, y: 2 }, label: '30°' };
  const added = addFBDAngle(selected, input, workspace, 'angle-1');
  assert.deepEqual(added.angles, [{ id: 'angle-1', ...input }]);
  assert.equal(JSON.stringify(workspace), before);
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  saveFBDState(storage, 'angle-student', added, workspace);
  assert.deepEqual(loadFBDState(storage, 'angle-student', workspace), added);
});

test('angle creation requires a target, text, unique ID, finite points, and distinct rays', () => {
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const input = { vertex: { x: 0, y: 0 }, from: { x: 1, y: 0 },
    to: { x: 0, y: 1 }, label: 'θ' };
  const added = addFBDAngle(selected, input, workspace, 'angle-1');
  assert.throws(() => addFBDAngle(added, input, workspace, 'angle-1'), /unique/);
  assert.throws(() => addFBDAngle(selected, { ...input, label: ' ' }, workspace, 'angle-2'), /angle text/);
  assert.throws(() => addFBDAngle(selected, { ...input, from: input.vertex }, workspace, 'angle-2'), /distinct/);
  assert.throws(() => addFBDAngle(selected, { ...input, to: { x: 2, y: 0 } }, workspace, 'angle-2'), /distinct/);
  assert.throws(() => addFBDAngle(selected, { ...input, to: { x: Infinity, y: 1 } }, workspace, 'angle-2'), /angle text/);
  assert.throws(() => addFBDAngle(createEmptyFBDState(workspace), input, workspace, 'angle-2'), /Select/);
});

test('angle scene renders an arc between reference rays with a selectable student label', () => {
  const angle = { id: 'angle-1', vertex: { x: 1, y: 2 }, from: { x: 2, y: 2 },
    to: { x: 1, y: 3 }, label: '30°' };
  const layout = angleArcLayout(angle, 4);
  assert.ok(Math.abs(layout.sweep - Math.PI / 2) < 1e-9);
  assert.equal(layout.points.length, 33);
  assert.ok(layout.labelPosition.x > angle.vertex.x);
  assert.ok(layout.labelPosition.y > angle.vertex.y);
  const group = buildFBDAngleArc(angle, 4, true);
  assert.equal(group.userData.fbdAngleId, angle.id);
  assert.equal(group.children.length, 3);
  assert.ok(group.children.every((child) => child.type === 'Line'));
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /textSprite\(angle\.label \|\| ''/);
  assert.match(panel, /angleArcLayout\(angle, span\)\.labelPosition/);
  assert.match(panel, /setSelectedAngleId\(object\.userData\.fbdAngleId/);
});

test('adding an angle never calculates its text or runs the solver and logs the student input', () => {
  let calls = 0;
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'joint', id: 'A' }, workspace);
  const added = addFBDAngle(selected, { vertex: { x: 0, y: 0 }, from: { x: 1, y: 0 },
    to: { x: 1, y: 1 }, label: 'given 30°' }, workspace, 'angle-1');
  assert.equal(added.angles[0].label, 'given 30°');
  assert.equal(visibleReactions(true, workspace, () => { calls += 1; return {}; }).result, null);
  assert.equal(calls, 0);
  const event = createVisualizationResearchEvent('session-1', 'fbd_angle_add',
    () => 'event-1', () => '2026-09-18T12:00:00.000Z', undefined, undefined, undefined, undefined, added.angles[0]);
  assert.equal(event.sessionId, 'session-1');
  assert.equal(event.timestamp, '2026-09-18T12:00:00.000Z');
  assert.deepEqual(event.angle, added.angles[0]);
});

test('student label persists its position, text, and optional association without changing the structure', () => {
  const before = JSON.stringify(workspace);
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const labels = [
    addFBDLabel(selected, { at: { x: 1, y: 1 }, text: 'Unknown force' }, workspace, 'label-1'),
    addFBDLabel(selected, { at: { x: 2, y: 1 }, text: 'A',
      associatedWith: { kind: 'node', id: 'A' } }, workspace, 'label-2'),
  ];
  const force = addFBDForce(selected, { at: { x: 2, y: 0 }, angle: -90, label: 'P' }, workspace, 'force-1');
  const withForceLabel = addFBDLabel(force, { at: { x: 2, y: 2 }, text: 'P',
    associatedWith: { kind: 'force', id: 'force-1' } }, workspace, 'label-3');
  assert.equal(labels[0].labels[0].associatedWith, undefined);
  assert.deepEqual(labels[1].labels[0].associatedWith, { kind: 'node', id: 'A' });
  assert.deepEqual(withForceLabel.labels[0].associatedWith, { kind: 'force', id: 'force-1' });
  assert.equal(JSON.stringify(workspace), before);
  const moved = moveFBDLabel(labels[1], 'label-2', { x: 3, y: 2 });
  assert.deepEqual(moved.labels[0], { id: 'label-2', at: { x: 3, y: 2 }, text: 'A',
    associatedWith: { kind: 'node', id: 'A' } });
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  saveFBDState(storage, 'label-student', moved, workspace);
  assert.deepEqual(loadFBDState(storage, 'label-student', workspace), moved);
});

test('labels validate text, position, association, and movement', () => {
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'joint', id: 'A' }, workspace);
  const input = { at: { x: 0, y: 0 }, text: 'R_A' };
  const added = addFBDLabel(selected, input, workspace, 'label-1');
  assert.throws(() => addFBDLabel(added, input, workspace, 'label-1'), /unique/);
  assert.throws(() => addFBDLabel(selected, { ...input, text: ' ' }, workspace, 'label-2'), /valid label/);
  assert.throws(() => addFBDLabel(selected, { ...input, at: { x: Infinity, y: 0 } }, workspace, 'label-2'), /valid label/);
  assert.throws(() => addFBDLabel(selected, { ...input,
    associatedWith: { kind: 'force', id: 'missing' } }, workspace, 'label-2'), /association/);
  assert.throws(() => addFBDLabel(createEmptyFBDState(workspace), input, workspace, 'label-2'), /Select/);
  assert.throws(() => moveFBDLabel(added, 'missing', { x: 1, y: 2 }), /Unknown/);
  assert.throws(() => moveFBDLabel(added, 'label-1', { x: NaN, y: 2 }), /finite/);
});

test('FBD panel renders selectable labels and supports moving on canvas without solver calls', () => {
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /textSprite\(item\.text, item\.id === selectedLabelId/);
  assert.match(panel, /sprite\.userData\.fbdLabelId = item\.id/);
  assert.match(panel, /setSelectedLabelId\(object\.userData\.fbdLabelId/);
  assert.match(panel, /moveFBDLabel\(fbdState, selectedLabelId/);
  let solverCalls = 0;
  assert.equal(visibleReactions(true, workspace, () => { solverCalls++; return {}; }).result, null);
  assert.equal(solverCalls, 0);
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const added = addFBDLabel(selected, { at: { x: 1, y: 1 }, text: 'Given' }, workspace, 'label-1');
  const event = createVisualizationResearchEvent('session-1', 'fbd_label_add',
    () => 'event-1', () => '2026-09-18T12:00:00.000Z', undefined, undefined, undefined, undefined, undefined, added.labels[0]);
  assert.deepEqual(event.label, added.labels[0]);
  assert.equal(event.sessionId, 'session-1');
});

test('editing and deleting every FBD element preserves EngineeringState and never solves', () => {
  const beforeStructure = JSON.stringify(workspace);
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const cases = [
    { kind: 'force', add: addFBDForce, edit: editFBDForce,
      first: { at: { x: 1, y: 0 }, angle: -90, label: 'P', magnitude: 10 },
      changed: { at: { x: 2, y: 1 }, angle: 45, label: 'Q' }, collection: 'forces' },
    { kind: 'moment', add: addFBDMoment, edit: editFBDMoment,
      first: { at: { x: 1, y: 0 }, clockwise: true, label: 'M', magnitude: 5 },
      changed: { at: { x: 3, y: 1 }, clockwise: false, label: 'N' }, collection: 'moments' },
    { kind: 'dimension', add: addFBDDimension, edit: editFBDDimension,
      first: { start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, label: '2 m' },
      changed: { start: { x: 1, y: 0 }, end: { x: 4, y: 0 }, label: '3 m' }, collection: 'dimensions' },
    { kind: 'angle', add: addFBDAngle, edit: editFBDAngle,
      first: { vertex: { x: 0, y: 0 }, from: { x: 1, y: 0 }, to: { x: 0, y: 1 }, label: '30°' },
      changed: { vertex: { x: 1, y: 1 }, from: { x: 2, y: 1 }, to: { x: 2, y: 2 }, label: '45°' }, collection: 'angles' },
    { kind: 'label', add: addFBDLabel, edit: editFBDLabel,
      first: { at: { x: 1, y: 1 }, text: 'A', associatedWith: { kind: 'node', id: 'A' } },
      changed: { at: { x: 3, y: 2 }, text: 'B' }, collection: 'labels' },
  ];
  for (const item of cases) {
    const id = `${item.kind}-1`;
    const added = item.add(selected, item.first, workspace, id);
    const original = getFBDElement(added, item.kind, id);
    const edited = item.edit(added, id, item.changed, workspace);
    assert.deepEqual(getFBDElement(edited, item.kind, id), { id, ...item.changed });
    assert.deepEqual(getFBDElement(added, item.kind, id), original);
    assert.equal(edited[item.collection].length, 1);
    const removed = deleteFBDElement(edited, item.kind, id);
    assert.equal(getFBDElement(removed, item.kind, id), undefined);
    assert.equal(removed[item.collection].length, 0);
    assert.equal(JSON.stringify(workspace), beforeStructure);
  }
  let calls = 0;
  assert.equal(visibleReactions(true, workspace, () => { calls++; return {}; }).result, null);
  assert.equal(calls, 0);
});

test('invalid FBD edits and deletes fail without changing state; deleting an associated element detaches its label', () => {
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const withForce = addFBDForce(selected, { at: { x: 1, y: 0 }, angle: -90, label: 'P' }, workspace, 'force-1');
  const withLabel = addFBDLabel(withForce, { at: { x: 1, y: 1 }, text: 'P',
    associatedWith: { kind: 'force', id: 'force-1' } }, workspace, 'label-1');
  const before = JSON.stringify(withLabel);
  assert.throws(() => editFBDForce(withLabel, 'force-1', { at: { x: 1, y: 0 }, angle: Infinity, label: 'P' }, workspace), /valid point/);
  assert.throws(() => editFBDDimension(withLabel, 'missing', { start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, label: '1 m' }, workspace), /Unknown/);
  assert.throws(() => deleteFBDElement(withLabel, 'moment', 'missing'), /Unknown/);
  assert.equal(JSON.stringify(withLabel), before);
  const removed = deleteFBDElement(withLabel, 'force', 'force-1');
  assert.deepEqual(removed.labels[0], { id: 'label-1', at: { x: 1, y: 1 }, text: 'P' });
  const event = createVisualizationResearchEvent('session-1', 'fbd_element_delete',
    () => 'event-1', () => '2026-09-18T12:00:00.000Z', undefined, undefined, undefined, undefined,
    undefined, undefined, { elementKind: 'force', elementId: 'force-1',
      before: withLabel.forces[0], after: null });
  assert.deepEqual(event.before, withLabel.forces[0]);
  assert.equal(event.after, null);
});

test('selected FBD elements expose edit controls and canvas selection', () => {
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  for (const kind of ['force', 'moment', 'dimension', 'angle', 'label']) {
    assert.match(panel, new RegExp(`selectedKind === '${kind}'`));
  }
  assert.match(panel, /aria-label=\{`Edit selected \$\{selectedKind\}`\}/);
  assert.match(panel, /Delete Selected/);
  assert.match(panel, /fbd_element_edit/);
  assert.match(panel, /fbd_element_delete/);
});

test('dragging every FBD annotation label changes display coordinates without changing semantic geometry', () => {
  const beforeStructure = JSON.stringify(workspace);
  let state = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  state = addFBDForce(state, { at: { x: 1, y: 0 }, angle: -90, magnitude: 10, label: 'P' }, workspace, 'force-1');
  state = addFBDMoment(state, { at: { x: 2, y: 0 }, clockwise: true, label: 'M' }, workspace, 'moment-1');
  state = addFBDDimension(state, { start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, label: '2 m' }, workspace, 'dimension-1');
  state = addFBDAngle(state, { vertex: { x: 0, y: 0 }, from: { x: 1, y: 0 },
    to: { x: 0, y: 1 }, label: '30°' }, workspace, 'angle-1');
  state = addFBDLabel(state, { at: { x: 1, y: 1 }, text: 'Given',
    associatedWith: { kind: 'force', id: 'force-1' } }, workspace, 'label-1');
  for (const kind of ['force', 'moment', 'dimension', 'angle', 'label']) {
    const id = `${kind}-1`;
    const before = structuredClone(getFBDElement(state, kind, id));
    const next = repositionFBDLabel(state, kind, id, { x: 3, y: 2 });
    const after = getFBDElement(next, kind, id);
    assert.deepEqual(getFBDElement(state, kind, id), before);
    if (kind === 'label') {
      assert.deepEqual(after.at, { x: 3, y: 2 });
      assert.deepEqual(after.associatedWith, before.associatedWith);
    } else {
      assert.deepEqual(after, { ...before, labelPosition: { x: 3, y: 2 } });
    }
    state = next;
  }
  assert.deepEqual(state.forces[0].at, { x: 1, y: 0 });
  assert.equal(state.forces[0].magnitude, 10);
  assert.deepEqual(state.moments[0].at, { x: 2, y: 0 });
  assert.deepEqual(state.dimensions[0].end, { x: 2, y: 0 });
  assert.deepEqual(state.angles[0].vertex, { x: 0, y: 0 });
  assert.equal(JSON.stringify(workspace), beforeStructure);
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  saveFBDState(storage, 'drag-student', state, workspace);
  assert.deepEqual(loadFBDState(storage, 'drag-student', workspace), state);
  let calls = 0;
  assert.equal(visibleReactions(true, workspace, () => { calls++; return {}; }).result, null);
  assert.equal(calls, 0);
});

test('force application moves only through explicit operation and retains a separately placed label', () => {
  const selected = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  const added = addFBDForce(selected, { at: { x: 1, y: 0 }, angle: -90, label: 'P' }, workspace, 'force-1');
  const placed = repositionFBDLabel(added, 'force', 'force-1', { x: 3, y: 2 });
  const moved = moveFBDForceApplication(placed, 'force-1', { x: 2, y: 0 }, workspace);
  assert.deepEqual(moved.forces[0].at, { x: 2, y: 0 });
  assert.deepEqual(moved.forces[0].labelPosition, { x: 3, y: 2 });
  assert.deepEqual(placed.forces[0].at, { x: 1, y: 0 });
  assert.throws(() => repositionFBDLabel(placed, 'force', 'force-1', { x: Infinity, y: 0 }), /finite/);
  assert.throws(() => moveFBDForceApplication(placed, 'force-1', { x: NaN, y: 0 }, workspace), /valid point/);
  const event = createVisualizationResearchEvent('session-1', 'fbd_element_drag',
    () => 'event-1', () => '2026-09-18T12:00:00.000Z', undefined, undefined, undefined, undefined,
    undefined, undefined, { elementKind: 'force', elementId: 'force-1',
      before: placed.forces[0], after: moved.forces[0], dragTarget: 'application' });
  assert.deepEqual(event.before, placed.forces[0]);
  assert.deepEqual(event.after, moved.forces[0]);
  assert.equal(event.dragTarget, 'application');
});

test('pointer interaction provides direct drag and coordinate alternatives without solver access', () => {
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /addEventListener\('pointerdown', handlePointerDown, true\)/);
  assert.match(panel, /addEventListener\('pointermove', handlePointerMove, true\)/);
  assert.match(panel, /addEventListener\('pointerup', handlePointerUp, true\)/);
  assert.match(panel, /fbdDragLabel/);
  assert.match(panel, /forceApplicationArmed &&|!forceApplicationArmed/);
  assert.match(panel, /Move application point \(drag arrow\)/);
  assert.match(panel, /aria-label="Position selected FBD label"/);
  assert.match(panel, /fbd_element_drag/);
});
