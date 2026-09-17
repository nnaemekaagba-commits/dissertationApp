import assert from 'node:assert/strict';
import test from 'node:test';
import { createStaticsWorkspace, parseStaticsWorkspace } from './model.ts';
import { loadStaticsWorkspace, saveStaticsWorkspace, staticsStorageKey } from './storage.ts';

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
  assert.deepEqual(loadStaticsWorkspace(storage, 'student-2'), createStaticsWorkspace());
  data.set(staticsStorageKey('student-1'), '{bad json');
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    assert.deepEqual(loadStaticsWorkspace(storage, 'student-1'), createStaticsWorkspace());
  } finally {
    console.warn = originalWarn;
  }
});
