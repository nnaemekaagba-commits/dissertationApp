import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSimplySupportedBeamReactions } from './calculations.ts';
import { createSimplySupportedBeamWorkspace } from './model.ts';

const solve = (workspace) => calculateSimplySupportedBeamReactions(workspace);
const verticals = (workspace) => solve(workspace).reactions.map((reaction) => reaction.vertical);

test('10 kN at the midpoint of a 4 m beam gives 5 kN at each support', () => {
  const workspace = createSimplySupportedBeamWorkspace();
  const before = JSON.stringify(workspace);
  assert.deepEqual(solve(workspace), {
    forceUnit: 'kN', lengthUnit: 'm',
    reactions: [
      { supportId: 'support-A', nodeId: 'A', kind: 'pin', horizontal: 0, vertical: 5 },
      { supportId: 'support-B', nodeId: 'B', kind: 'roller', horizontal: 0, vertical: 5 },
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

test('unsupported geometry, supports, and load types fail explicitly', () => {
  const base = createSimplySupportedBeamWorkspace();
  assert.throws(() => solve({ ...base, supports: [{ ...base.supports[0], kind: 'fixed' }, base.supports[1]] }), /one pin and one roller/);
  assert.throws(() => solve({ ...base, loads: [{ ...base.loads[0], angle: 0 }] }), /not vertical/);
  assert.throws(() => solve({ ...base, loads: [{ id: 'M', kind: 'moment', nodeId: 'C', magnitude: 3 }] }), /Only vertical point loads/);
  assert.throws(() => solve({ ...base, nodes: base.nodes.map((node) => node.id === 'B' ? { ...node, y: 1 } : node) }), /Only horizontal beams/);
});
