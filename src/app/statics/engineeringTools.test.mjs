import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { executeEngineeringTool, executeEngineeringToolBatch, formatEngineeringToolBatch } from './engineeringTools.ts';
import { selectSceneData } from './sceneData.ts';
import { createToolResearchEvents, createVisualizationResearchEvent, getEngineeringSessionId } from './researchLog.ts';

const initial = () => createSimplySupportedBeamWorkspace();
const call = (workspace, name, args = {}) => executeEngineeringTool(workspace, { id: 'test', name, arguments: args });

test('read-only tools return the current structure and deterministic reactions', () => {
  const workspace = initial();
  assert.deepEqual(call(workspace, 'get_current_structure').result.structure, workspace);
  assert.deepEqual(call(workspace, 'calculate_reactions').result.calculation.reactions.map(({ vertical }) => vertical), [5, 5]);
  assert.equal(call(workspace, 'calculate_reactions').workspace, workspace);
});

test('structure and view replies use actual tool results', () => {
  const batch = executeEngineeringToolBatch(initial(), [
    { id: 'structure', name: 'get_current_structure', arguments: {} },
    { id: 'view', name: 'show_view', arguments: { view: 'front' } },
  ]);
  assert.match(formatEngineeringToolBatch(batch), /3 nodes, 1 member, 2 supports, 1 load/);
  assert.match(formatEngineeringToolBatch(batch), /Showing the front view/);
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

test('multiple edits update the model without invoking or reporting the solver', () => {
  const before = initial();
  const batch = executeEngineeringToolBatch(before, [
    { id: 'magnitude', name: 'change_load_magnitude', arguments: { loadId: 'load-C', magnitude: 12 } },
    { id: 'position', name: 'move_load', arguments: { loadId: 'load-C', position: 3 } },
  ]);
  assert.equal(batch.structureChanged, true);
  assert.equal(batch.outcome.structure, batch.workspace);
  assert.equal(batch.outcome.structure.loads[0].magnitude, 12);
  assert.equal(batch.outcome.structure.nodes.find(({ id }) => id === 'C').x, 3);
  assert.equal(batch.outcome.calculation, undefined);
  assert.ok(batch.interactions.every((item) => item.calculation === undefined));
  assert.doesNotMatch(formatEngineeringToolBatch(batch), /Support reactions|Fy =/);
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

test('member dimensions and load additions/removals are validated state changes', () => {
  const beam = call(initial(), 'change_member_dimension', { memberId: 'AB', value: 6 }).workspace;
  assert.equal(beam.nodes.find(({ id }) => id === 'B').x, 6);
  const loaded = call(beam, 'add_load', { loadId: 'extra', kind: 'force', magnitude: 6, position: 4 }).workspace;
  assert.equal(loaded.loads.length, 2);
  assert.equal(loaded.nodes.find(({ id }) => id === 'load-node-extra').x, 4);
  const reactions = call(loaded, 'calculate_reactions').result.calculation.reactions.map(({ vertical }) => vertical);
  assert.ok(Math.abs(reactions[0] - 26 / 3) < 1e-9);
  assert.ok(Math.abs(reactions[1] - 22 / 3) < 1e-9);
  const removed = call(loaded, 'remove_load', { loadId: 'extra' }).workspace;
  assert.equal(removed.loads.length, 1);
  assert.equal(removed.nodes.some(({ id }) => id === 'load-node-extra'), false);
  assert.throws(() => call(beam, 'add_load', { loadId: 'load-C', kind: 'force', magnitude: 2, position: 3 }), /already exists/);
  assert.throws(() => call(beam, 'add_load', { loadId: 'x', kind: 'force', magnitude: 2, position: 6 }), /strictly inside/);
  assert.throws(() => call(beam, 'remove_load', { loadId: 'unknown' }), /does not exist/);
  assert.throws(() => call(beam, 'change_member_dimension', { memberId: 'fake', value: 8 }), /not the editable/);
  assert.throws(() => call(loaded, 'change_member_dimension', { memberId: 'AB', value: 3 }), /outside the resized beam/);
});

test('unsupported edited structure is not solved until the student requests calculation', () => {
  const batch = executeEngineeringToolBatch(initial(), [
    { id: 'remove', name: 'change_support', arguments: { nodeId: 'B', kind: 'none' } },
  ]);
  assert.equal(batch.structureChanged, true);
  assert.equal(batch.outcome.calculationError, undefined);
  assert.equal(batch.interactions[0].calculationError, undefined);
  assert.doesNotMatch(formatEngineeringToolBatch(batch), /Fy =/);
  const requested = executeEngineeringToolBatch(batch.workspace, [
    { id: 'solve', name: 'calculate_reactions', arguments: {} },
  ], undefined, 'Calculate the reactions.');
  assert.equal(requested.results[0].success, false);
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

test('each valid edit publishes state that the scene selector renders', () => {
  const published = [];
  const batch = executeEngineeringToolBatch(initial(), [
    { id: 'move', name: 'move_load', arguments: { loadId: 'load-C', position: 3 } },
    { id: 'magnitude', name: 'change_load_magnitude', arguments: { loadId: 'load-C', magnitude: 12 } },
    { id: 'support', name: 'change_support', arguments: { nodeId: 'B', kind: 'pin' } },
  ], (next) => published.push(next));
  assert.equal(published.length, 3);
  assert.equal(selectSceneData(published[0]).nodes.find(({ id }) => id === 'C').x, 3);
  assert.equal(selectSceneData(published[1]).loads[0].magnitude, 12);
  assert.equal(selectSceneData(published[2]).supports.find(({ nodeId }) => nodeId === 'B').kind, 'pin');
  assert.equal(selectSceneData(batch.workspace).loads, batch.workspace.loads);
  assert.ok(batch.interactions.every((item) => item.calculation === undefined && item.calculationError === undefined));
  assert.doesNotMatch(formatEngineeringToolBatch(batch), /Reactions could not be calculated|Fy =/);
});

test('failed edits publish no state and cannot generate a success confirmation', () => {
  let publishCount = 0;
  const batch = executeEngineeringToolBatch(initial(), [
    { id: 'bad', name: 'move_load', arguments: { loadId: 'missing', position: 3 } },
  ], () => { publishCount++; });
  assert.equal(publishCount, 0);
  assert.equal(batch.results[0].success, false);
  assert.deepEqual(batch.interactions[0].before, batch.interactions[0].after);
  assert.doesNotMatch(formatEngineeringToolBatch(batch), /Moved load/);
});

test('research records edit state without invented solver output', () => {
  const batch = executeEngineeringToolBatch(initial(), [
    { id: 'good', name: 'move_load', arguments: { loadId: 'load-C', position: 3 } },
    { id: 'bad', name: 'change_support', arguments: { nodeId: 'missing', kind: 'pin' } },
  ]);
  const reply = formatEngineeringToolBatch(batch);
  const events = createToolResearchEvents('session-1', 'Move the load', batch, reply,
    () => 'event-1', () => '2026-09-17T12:00:00.000Z');
  assert.equal(events.length, 2);
  assert.equal(events[0].sessionId, 'session-1');
  assert.equal(events[0].stateBefore.nodes.find(({ id }) => id === 'C').x, 2);
  assert.equal(events[0].stateAfter.nodes.find(({ id }) => id === 'C').x, 3);
  assert.equal(events[0].solverResult, undefined);
  assert.equal(events[0].aiResponse, reply);
  assert.equal(events[1].succeeded, false);
  assert.equal(events[1].stateBefore, events[1].stateAfter);
  assert.match(events[1].error, /Support node/);
});

test('view logging uses a stable per-user session and separate event kind', () => {
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) || null, setItem: (key, value) => records.set(key, value) };
  const sessionId = getEngineeringSessionId(storage, 'student-1', () => 'session-1');
  assert.equal(getEngineeringSessionId(storage, 'student-1', () => 'different'), sessionId);
  const event = createVisualizationResearchEvent(sessionId, 'isometric',
    () => 'view-1', () => '2026-09-17T12:00:00.000Z');
  assert.equal(event.kind, 'visualization');
  assert.equal(event.action, 'isometric');
});

test('malformed tool arguments remain loggable as a failed interaction', () => {
  const batch = executeEngineeringToolBatch(initial(), [
    { id: 'missing-args', name: 'move_load' },
  ]);
  const [event] = createToolResearchEvents('session-1', 'Move the load', batch, formatEngineeringToolBatch(batch),
    () => 'event-1', () => '2026-09-17T12:00:00.000Z');
  assert.equal(event.succeeded, false);
  assert.equal(event.toolArguments, null);
  assert.equal(event.stateBefore, event.stateAfter);
});
