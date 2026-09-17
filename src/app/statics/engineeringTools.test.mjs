import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { executeEngineeringTool, executeEngineeringToolBatch, formatEngineeringToolBatch } from './engineeringTools.ts';

const initial = () => createSimplySupportedBeamWorkspace();
const call = (workspace, name, args = {}) => executeEngineeringTool(workspace, { id: 'test', name, arguments: args });

test('read-only tools return the current structure and deterministic reactions', () => {
  const workspace = initial();
  assert.deepEqual(call(workspace, 'get_current_structure').result.structure, workspace);
  assert.deepEqual(call(workspace, 'calculate_reactions').result.calculation.reactions.map(({ vertical }) => vertical), [5, 5]);
  assert.equal(call(workspace, 'calculate_reactions').workspace, workspace);
});

test('load and dimension tools update geometry and reactions through structured state', () => {
  const workspace = initial();
  const heavier = call(workspace, 'change_load_magnitude', { loadId: 'load-C', magnitude: 12 }).workspace;
  assert.equal(heavier.loads[0].magnitude, 12);
  const moved = call(heavier, 'move_load', { loadId: 'load-C', position: 3 }).workspace;
  assert.equal(moved.nodes.find(({ id }) => id === 'C').x, 3);
  assert.deepEqual(moved.dimensions.map(({ value }) => value), [3, 1, 4]);
  assert.deepEqual(call(moved, 'calculate_reactions').result.calculation.reactions.map(({ vertical }) => vertical), [3, 9]);
  const resized = call(moved, 'change_dimension', { dimensionId: 'A-B', value: 6 }).workspace;
  assert.equal(resized.nodes.find(({ id }) => id === 'B').x, 6);
  assert.deepEqual(resized.dimensions.map(({ value }) => value), [3, 3, 6]);
  assert.equal(workspace.nodes.find(({ id }) => id === 'B').x, 4);
});

test('support and UI tools return explicit actions without changing unrelated state', () => {
  const workspace = initial();
  const fixed = call(workspace, 'change_support', { nodeId: 'A', kind: 'fixed' }).workspace;
  const cantilever = call(fixed, 'change_support', { nodeId: 'B', kind: 'none' }).workspace;
  assert.equal(call(cantilever, 'calculate_reactions').result.calculation.reactions[0].moment, 20);
  assert.deepEqual(call(workspace, 'show_view', { view: 'isometric' }).uiAction, { kind: 'view', view: 'isometric' });
  assert.deepEqual(call(workspace, 'show_fbd', { visible: true }).uiAction, { kind: 'fbd', visible: true });
  assert.equal(call(workspace, 'show_fbd', { visible: true }).workspace, workspace);
});

test('tool arguments reject unknown fields, wrong types, missing entities, and unsafe geometry', () => {
  const workspace = initial();
  assert.throws(() => call(workspace, 'get_current_structure', { extra: 1 }), /only/);
  assert.throws(() => call(workspace, 'change_load_magnitude', { loadId: 'load-C', magnitude: '20' }), /finite/);
  assert.throws(() => call(workspace, 'change_load_magnitude', { loadId: 'missing', magnitude: 20 }), /does not exist/);
  assert.throws(() => call(workspace, 'move_load', { loadId: 'load-C', position: 4 }), /strictly inside/);
  assert.throws(() => call(workspace, 'change_support', { nodeId: 'A', kind: 'fixed', reactionAngle: 45 }), /only to a roller/);
  assert.throws(() => call(workspace, 'change_dimension', { dimensionId: 'A-B', value: -1 }), /positive/);
  assert.throws(() => call(workspace, 'show_view', { view: 'sideways' }), /must be one of/);
  assert.throws(() => call(workspace, 'show_fbd', { visible: 'yes' }), /boolean/);
  assert.throws(() => call(workspace, 'calculate_reactions', { bogus: true }), /only/);
  assert.throws(() => call(workspace, 'delete_everything', {}), /must be one of/);
  assert.throws(() => call(workspace, 'move_load', '{bad'), /valid JSON/);
});

test('multiple edits use the final model for one deterministic solver result', () => {
  const before = initial();
  const batch = executeEngineeringToolBatch(before, [
    { id: 'magnitude', name: 'change_load_magnitude', arguments: { loadId: 'load-C', magnitude: 12 } },
    { id: 'position', name: 'move_load', arguments: { loadId: 'load-C', position: 3 } },
  ]);
  assert.equal(batch.structureChanged, true);
  assert.equal(batch.outcome.structure, batch.workspace);
  assert.equal(batch.outcome.structure.loads[0].magnitude, 12);
  assert.equal(batch.outcome.structure.nodes.find(({ id }) => id === 'C').x, 3);
  assert.deepEqual(batch.outcome.calculation.reactions.map(({ vertical }) => vertical), [3, 9]);
  assert.match(formatEngineeringToolBatch(batch), /A: Fx = 0 kN, Fy = 3 kN/);
  assert.match(formatEngineeringToolBatch(batch), /B: Fx = 0 kN, Fy = 9 kN/);
  assert.match(formatEngineeringToolBatch(batch), /load-C magnitude to 12 kN/);
  assert.equal(before.loads[0].magnitude, 10);
});

test('reaction requests display the solver output without a model-generated calculation', () => {
  const batch = executeEngineeringToolBatch(initial(), [
    { id: 'solve', name: 'calculate_reactions', arguments: {} },
  ]);
  assert.equal(batch.structureChanged, false);
  assert.match(formatEngineeringToolBatch(batch), /A: Fx = 0 kN, Fy = 5 kN/);
  assert.match(formatEngineeringToolBatch(batch), /B: Fx = 0 kN, Fy = 5 kN/);
});

test('unsupported edited structure reports solver failure without made-up reactions', () => {
  const batch = executeEngineeringToolBatch(initial(), [
    { id: 'remove', name: 'change_support', arguments: { nodeId: 'B', kind: 'none' } },
  ]);
  assert.equal(batch.structureChanged, true);
  assert.ok(batch.outcome.calculationError);
  assert.match(formatEngineeringToolBatch(batch), /Reactions could not be calculated/);
  assert.doesNotMatch(formatEngineeringToolBatch(batch), /Fy =/);
});

test('invalid edit does not mutate the structure or report a solver result', () => {
  const before = initial();
  const batch = executeEngineeringToolBatch(before, [
    { id: 'bad', name: 'change_load_magnitude', arguments: { loadId: 'missing', magnitude: 12 } },
  ]);
  assert.equal(batch.workspace, before);
  assert.equal(batch.structureChanged, false);
  assert.equal(batch.outcome, undefined);
  assert.match(formatEngineeringToolBatch(batch), /does not exist/);
  assert.doesNotMatch(formatEngineeringToolBatch(batch), /Fy =/);
  assert.throws(() => executeEngineeringToolBatch(before, [
    { id: 'same', name: 'show_view', arguments: { view: 'front' } },
    { id: 'same', name: 'show_fbd', arguments: { visible: true } },
  ]), /invalid engineering tool call/);
});
