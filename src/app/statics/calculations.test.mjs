import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSimplySupportedBeamReactions } from './calculations.ts';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { updateBeamLoadKind, updateBeamLoadValue, updateBeamWorkspace } from './beamControls.ts';

const solve = (workspace) => calculateSimplySupportedBeamReactions(workspace);
const verticals = (workspace) => solve(workspace).reactions.map((reaction) => reaction.vertical);

test('10 kN at the midpoint of a 4 m beam gives 5 kN at each support', () => {
  const workspace = createSimplySupportedBeamWorkspace();
  const before = JSON.stringify(workspace);
  assert.deepEqual(solve(workspace), {
    forceUnit: 'kN', lengthUnit: 'm', momentUnit: 'kN*m',
    reactions: [
      { supportId: 'support-A', nodeId: 'A', kind: 'pin', horizontal: 0, vertical: 5, moment: 0 },
      { supportId: 'support-B', nodeId: 'B', kind: 'roller', horizontal: 0, vertical: 5, moment: 0 },
    ],
    equilibrium: { horizontalResidual: 0, verticalResidual: 0, momentResidualAboutLeft: 0 },
  });
  assert.equal(JSON.stringify(workspace), before);
});

test('10 kN at 3 m from A gives 2.5 kN at A and 7.5 kN at B', () => {
  const workspace = createSimplySupportedBeamWorkspace();
  workspace.nodes.find((node) => node.id === 'C').x = 3;
  assert.deepEqual(verticals(workspace), [2.5, 7.5]);
});

test('editing the workspace load automatically yields updated reaction data', () => {
  const original = createSimplySupportedBeamWorkspace();
  const moved = updateBeamWorkspace(original, { field: 'loadPosition', value: 3 });
  const heavier = updateBeamWorkspace(moved, { field: 'loadMagnitude', value: 12 });
  assert.deepEqual(verticals(original), [5, 5]);
  assert.deepEqual(verticals(moved), [2.5, 7.5]);
  assert.deepEqual(verticals(heavier), [3, 9]);
});

test('two point loads add by moment balance', () => {
  const workspace = createSimplySupportedBeamWorkspace();
  workspace.nodes.push({ id: 'D', x: 1, y: 0 }, { id: 'E', x: 3, y: 0 });
  workspace.loads = [
    { id: 'P1', kind: 'force', nodeId: 'D', magnitude: 8, angle: -90 },
    { id: 'P2', kind: 'force', nodeId: 'E', magnitude: 4, angle: -90 },
  ];
  assert.deepEqual(verticals(workspace), [7, 5]);
});

test('supports can be reversed and radian angles give the same result', () => {
  const workspace = createSimplySupportedBeamWorkspace();
  workspace.units.angle = 'rad';
  workspace.loads[0].angle = -Math.PI / 2;
  workspace.supports = [
    { id: 'roller-A', nodeId: 'A', kind: 'roller', reactionAngle: Math.PI / 2 },
    { id: 'pin-B', nodeId: 'B', kind: 'pin' },
  ];
  assert.deepEqual(verticals(workspace), [5, 5]);
});

test('horizontal point load is resisted by the pin', () => {
  const workspace = createSimplySupportedBeamWorkspace();
  workspace.loads.push({ id: 'H', kind: 'force', nodeId: 'C', magnitude: 6, angle: 0 });
  const result = solve(workspace);
  assert.equal(result.reactions[0].horizontal, -6);
  assert.equal(result.reactions[1].horizontal, 0);
  assert.deepEqual(verticals(workspace), [5, 5]);
  assert.deepEqual(result.equilibrium, { horizontalResidual: 0, verticalResidual: 0, momentResidualAboutLeft: 0 });
});

test('uniform and triangular distributed loads have analytical reactions', () => {
  const workspace = createSimplySupportedBeamWorkspace();
  workspace.loads = [{ id: 'q', kind: 'distributed', memberId: 'AB', startMagnitude: 2, endMagnitude: 2, angle: -90 }];
  assert.deepEqual(verticals(workspace), [4, 4]);
  workspace.loads[0].startMagnitude = 0;
  workspace.loads[0].endMagnitude = 3;
  assert.deepEqual(verticals(workspace), [2, 4]);
  workspace.members[0] = { id: 'AB', startNodeId: 'B', endNodeId: 'A' };
  assert.deepEqual(verticals(workspace), [4, 2]);
});

test('applied couple and explicit moment unit convert correctly', () => {
  const workspace = createSimplySupportedBeamWorkspace();
  workspace.loads = [{ id: 'M', kind: 'moment', nodeId: 'C', magnitude: 8 }];
  assert.deepEqual(verticals(workspace), [2, -2]);
  workspace.units.moment = 'N*m';
  workspace.loads[0].magnitude = 8000;
  assert.deepEqual(verticals(workspace), [2, -2]);
});

test('one fixed support solves cantilever vertical, horizontal, and moment reactions', () => {
  const workspace = createSimplySupportedBeamWorkspace();
  workspace.supports = [{ id: 'fixed-A', nodeId: 'A', kind: 'fixed' }];
  workspace.loads.push({ id: 'H', kind: 'force', nodeId: 'C', magnitude: 6, angle: 0 });
  assert.deepEqual(solve(workspace).reactions, [
    { supportId: 'fixed-A', nodeId: 'A', kind: 'fixed', horizontal: -6, vertical: 10, moment: 20 },
  ]);
});

test('editor changes to distributed loads, moments, and a cantilever reach the solver', () => {
  const initial = createSimplySupportedBeamWorkspace();
  const distributed = updateBeamLoadKind(initial, 'distributed');
  assert.deepEqual(verticals(distributed), [4, 4]);
  const moment = updateBeamLoadValue(updateBeamLoadKind(initial, 'moment'), 'magnitude', 8);
  assert.deepEqual(verticals(moment), [2, -2]);
  const cantilever = updateBeamWorkspace(updateBeamWorkspace(initial, { field: 'supportB', value: 'none' }),
    { field: 'supportA', value: 'fixed' });
  assert.equal(solve(cantilever).reactions[0].moment, 20);
});

test('inclined roller reaction is resolved into horizontal and vertical components', () => {
  const workspace = createSimplySupportedBeamWorkspace();
  workspace.supports[1].reactionAngle = 45;
  const reactions = solve(workspace).reactions;
  assert.ok(Math.abs(reactions[0].horizontal + 5) < 1e-10);
  assert.ok(Math.abs(reactions[1].horizontal - 5) < 1e-10);
  assert.deepEqual(reactions.map(({ vertical }) => vertical), [5, 5]);
});

test('unsupported geometry and indeterminate or unstable supports fail explicitly', () => {
  const base = createSimplySupportedBeamWorkspace();
  assert.throws(() => solve({ ...base, supports: [{ ...base.supports[0], kind: 'fixed' }, base.supports[1]] }), /exactly three/);
  assert.throws(() => solve({ ...base, supports: [{ ...base.supports[0], kind: 'pin' }, { ...base.supports[1], kind: 'pin', reactionAngle: undefined }] }), /exactly three/);
  assert.throws(() => solve({ ...base, supports: [{ ...base.supports[0] }, { ...base.supports[1], reactionAngle: 0 }] }), /unstable/);
  assert.throws(() => solve({ ...base, nodes: base.nodes.map((node) => node.id === 'B' ? { ...node, y: 1 } : node) }), /Only horizontal beams/);
});
