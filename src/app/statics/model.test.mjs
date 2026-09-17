import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimplySupportedBeamWorkspace, createStaticsWorkspace, parseStaticsWorkspace } from './model.ts';
import { loadStaticsWorkspace, saveStaticsWorkspace, staticsStorageKey } from './storage.ts';
import { readBeamControls, updateBeamWorkspace } from './beamControls.ts';

const example = () => ({
  ...createStaticsWorkspace(),
  nodes: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 3, y: 0 }, { id: 'C', x: 3, y: 4 }],
  members: [{ id: 'AB', startNodeId: 'A', endNodeId: 'B' }],
  supports: [{ id: 'pin-A', nodeId: 'A', kind: 'pin' }, { id: 'roller-B', nodeId: 'B', kind: 'roller', reactionAngle: 90 }],
  loads: [
    { id: 'F', kind: 'force', nodeId: 'C', magnitude: 12, angle: -90 },
    { id: 'M', kind: 'moment', nodeId: 'B', magnitude: 2 },
    { id: 'q', kind: 'distributed', memberId: 'AB', startMagnitude: 2, endMagnitude: 4, angle: -90 },
  ],
  dimensions: [{ id: 'd', startNodeId: 'A', endNodeId: 'B', value: 3 }],
  angles: [{ id: 'theta', vertexNodeId: 'A', fromNodeId: 'B', toNodeId: 'C', value: 45 }],
});

test('all statics entities and units survive JSON serialization', () => {
  const workspace = example();
  assert.deepEqual(parseStaticsWorkspace(JSON.parse(JSON.stringify(workspace))), workspace);
});

test('empty state matches the requested JSON structure', () => {
  assert.deepEqual(createStaticsWorkspace(), {
    nodes: [], members: [], supports: [], loads: [], dimensions: [],
    units: { length: 'm', force: 'kN' },
  });
  assert.deepEqual(parseStaticsWorkspace(createStaticsWorkspace()), createStaticsWorkspace());
});

test('starting beam is valid data with a central downward load and two support kinds', () => {
  const beam = createSimplySupportedBeamWorkspace();
  assert.deepEqual(parseStaticsWorkspace(JSON.parse(JSON.stringify(beam))), beam);
  assert.deepEqual(beam.nodes.map(({ id, x, y }) => [id, x, y]),
    [['A', 0, 0], ['C', 2, 0], ['B', 4, 0]]);
  assert.deepEqual(beam.supports.map(({ nodeId, kind }) => [nodeId, kind]),
    [['A', 'pin'], ['B', 'roller']]);
  assert.deepEqual(beam.loads, [{ id: 'load-C', kind: 'force', nodeId: 'C', magnitude: 10, angle: -90 }]);
  assert.deepEqual(beam.dimensions.map(({ value }) => value), [2, 2, 4]);
});

test('beam controls update the single workspace and its dimensions', () => {
  const initial = createSimplySupportedBeamWorkspace();
  const longer = updateBeamWorkspace(initial, { field: 'length', value: 6 });
  assert.equal(readBeamControls(initial).length, 4);
  assert.equal(readBeamControls(longer).length, 6);
  assert.deepEqual(longer.dimensions.map(({ value }) => value), [2, 4, 6]);
  const moved = updateBeamWorkspace(longer, { field: 'loadPosition', value: 3 });
  assert.equal(readBeamControls(moved).loadPosition, 3);
  assert.deepEqual(moved.dimensions.map(({ value }) => value), [3, 3, 6]);
  const loaded = updateBeamWorkspace(moved, { field: 'loadMagnitude', value: 18 });
  assert.equal(readBeamControls(loaded).loadMagnitude, 18);
  const fixed = updateBeamWorkspace(loaded, { field: 'supportB', value: 'fixed' });
  assert.equal(readBeamControls(fixed).supportB, 'fixed');
  assert.equal(fixed.supports.find(({ nodeId }) => nodeId === 'B').reactionAngle, undefined);
  assert.deepEqual(parseStaticsWorkspace(fixed), fixed);
  assert.equal(updateBeamWorkspace(fixed, { field: 'loadPosition', value: 6 }), fixed);
});

test('reads the earlier stored format without losing angle annotations or units', () => {
  const old = { ...example(), id: 'old-problem', schemaVersion: 1,
    units: { length: 'm', force: 'N', moment: 'N*m', angle: 'deg' } };
  assert.deepEqual(parseStaticsWorkspace(old), exampleWithOldUnits());
});

const exampleWithOldUnits = () => ({ ...example(),
  units: { length: 'm', force: 'N', moment: 'N*m', angle: 'deg' } });

test('rejects missing references, duplicate IDs, and non-finite geometry', () => {
  assert.throws(() => parseStaticsWorkspace({ ...example(), members: [{ id: 'AB', startNodeId: 'A', endNodeId: 'missing' }] }), /members\[0\].endNodeId/);
  assert.throws(() => parseStaticsWorkspace({ ...example(), nodes: [...example().nodes, { id: 'A', x: 5, y: 5 }] }), /duplicate id/);
  assert.throws(() => parseStaticsWorkspace({ ...example(), nodes: [{ id: 'A', x: Infinity, y: 0 }, ...example().nodes.slice(1)] }), /nodes\[0\].x/);
  assert.throws(() => parseStaticsWorkspace({ ...example(), units: { ...example().units, force: 'watts' } }), /units.force/);
});

test('saves per user and recovers from corrupt stored JSON', () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  saveStaticsWorkspace(storage, 'student-1', example());
  assert.deepEqual(loadStaticsWorkspace(storage, 'student-1'), example());
  assert.deepEqual(loadStaticsWorkspace(storage, 'student-2'), createSimplySupportedBeamWorkspace());
  saveStaticsWorkspace(storage, 'student-2', createStaticsWorkspace());
  assert.deepEqual(loadStaticsWorkspace(storage, 'student-2'), createStaticsWorkspace());
  data.set('mydis-statics:v1:student-3', JSON.stringify(createStaticsWorkspace()));
  assert.deepEqual(loadStaticsWorkspace(storage, 'student-3'), createSimplySupportedBeamWorkspace());
  data.set('mydis-statics:v1:student-4', JSON.stringify(example()));
  assert.deepEqual(loadStaticsWorkspace(storage, 'student-4'), example());
  data.set(staticsStorageKey('student-1'), '{bad json');
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    assert.deepEqual(loadStaticsWorkspace(storage, 'student-1'), createSimplySupportedBeamWorkspace());
  } finally {
    console.warn = originalWarn;
  }
});
