import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { createEmptyFBDState, engineeringStructureKey, fbdStorageKey, loadFBDState,
  saveFBDState, selectFBDTarget, addFBDForce, visibleReactions, createFBDHistory, applyFBDChange,
  undoFBDChange, redoFBDChange } from './fbdState.ts';
import { buildFBDForceArrow } from './fbdForceScene.ts';
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
