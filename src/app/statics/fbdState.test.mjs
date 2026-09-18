import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { createEmptyFBDState, engineeringStructureKey, fbdStorageKey, loadFBDState,
  saveFBDState, selectFBDTarget, addFBDForce, addFBDMoment, addFBDDimension, addFBDAngle,
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
