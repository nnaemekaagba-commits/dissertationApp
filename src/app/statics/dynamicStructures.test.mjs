import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createStaticsWorkspace, parseStaticsWorkspace } from './model.ts';
import { executeEngineeringTool, executeEngineeringToolBatch } from './engineeringTools.ts';
import { fbdTargetOptions } from './fbdTargetOptions.ts';
import { selectSceneData } from './sceneData.ts';
import { addFBDForce, associateFBDState, createEmptyFBDState, selectFBDTarget,
  isolatedFBDGeometry } from './fbdState.ts';

const call = (workspace, name, args) => executeEngineeringTool(workspace,
  { id: `${name}-1`, name, arguments: args }).workspace;
const nodes = (ids) => ids.map((id, index) => ({ id, x: index % 4, y: Math.floor(index / 4) }));
const members = (ids) => ids.slice(1).map((id, index) => ({ id: `M${index + 1}`,
  startNodeId: ids[index], endNodeId: id }));
const create = (ids, links = members(ids)) => call(createStaticsWorkspace(), 'create_structure',
  { nodes: nodes(ids), members: links });

test('2-node beam, triangular truss, 5-joint truss, and 12-node frame render every model member', () => {
  const cases = [
    { ids: ['A', 'B'], links: [{ id: 'AB', startNodeId: 'A', endNodeId: 'B' }] },
    { ids: ['A', 'B', 'C'], links: [
      { id: 'AB', startNodeId: 'A', endNodeId: 'B' },
      { id: 'BC', startNodeId: 'B', endNodeId: 'C' },
      { id: 'AC', startNodeId: 'A', endNodeId: 'C' }] },
    { ids: ['A', 'B', 'C', 'D', 'E'], links: members(['A', 'B', 'C', 'D', 'E']) },
    { ids: Array.from({ length: 12 }, (_, index) => `Node${index + 1}`), links: undefined },
    { ids: ['Hub', 'North', 'East', 'South', 'West', 'Tip'], links: [
      { id: 'NorthArm', startNodeId: 'Hub', endNodeId: 'North' },
      { id: 'EastArm', startNodeId: 'Hub', endNodeId: 'East' },
      { id: 'SouthArm', startNodeId: 'Hub', endNodeId: 'South' },
      { id: 'WestArm', startNodeId: 'Hub', endNodeId: 'West' },
      { id: 'TipBrace', startNodeId: 'East', endNodeId: 'Tip' }] },
  ];
  for (const { ids, links } of cases) {
    const workspace = create(ids, links);
    assert.equal(workspace.nodes.length, ids.length);
    assert.equal(workspace.members.length, links?.length ?? ids.length - 1);
    assert.deepEqual(selectSceneData(workspace).members, workspace.members);
    assert.deepEqual(selectSceneData(workspace).nodes, workspace.nodes);
    assert.equal(fbdTargetOptions(workspace).length, 1 + workspace.nodes.length + workspace.members.length);
    for (const node of workspace.nodes) assert.ok(fbdTargetOptions(workspace).some((item) =>
      item.target.kind === 'joint' && item.target.id === node.id));
    for (const member of workspace.members) {
      const fbd = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'member', id: member.id }, workspace);
      assert.deepEqual(isolatedFBDGeometry(fbd, workspace).members, [member]);
    }
    const body = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
    assert.equal(isolatedFBDGeometry(body, workspace).members.length, workspace.members.length);
  }
  const panel = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /sceneData\.members\.forEach/);
  assert.match(panel, /sceneData\.nodes\.forEach/);
  assert.match(panel, /at\(member\.startNodeId\)/);
  assert.match(panel, /at\(member\.endNodeId\)/);
});

test('arbitrary joint and member IDs can be added, removed, and selected after every state change', () => {
  let workspace = create(['J1', 'J2'], [{ id: 'Member_12', startNodeId: 'J1', endNodeId: 'J2' }]);
  workspace = call(workspace, 'add_node', { id: 'Node3', x: 4, y: 3 });
  workspace = call(workspace, 'add_member', { id: 'M2', startNodeId: 'J2', endNodeId: 'Node3' });
  assert.deepEqual(fbdTargetOptions(workspace, 'node3').map((item) => item.target.id), ['Node3']);
  assert.deepEqual(fbdTargetOptions(workspace, 'member_12').map((item) => item.target.id), ['Member_12']);
  assert.throws(() => call(workspace, 'remove_node', { id: 'Node3' }), /referenced/);
  workspace = call(workspace, 'remove_member', { id: 'M2' });
  workspace = call(workspace, 'remove_node', { id: 'Node3' });
  assert.ok(!fbdTargetOptions(workspace).some((item) => item.target.id === 'Node3' || item.target.id === 'M2'));
  assert.ok(fbdTargetOptions(workspace).some((item) => item.target.id === 'Member_12'));
});

test('duplicate IDs, missing endpoints, duplicate members, and invalid geometry fail atomically', () => {
  const workspace = create(['J1', 'J2']);
  const before = JSON.stringify(workspace);
  assert.throws(() => call(workspace, 'add_node', { id: 'J1', x: 3, y: 0 }), /duplicate id/);
  assert.throws(() => call(workspace, 'add_member', { id: 'M9', startNodeId: 'J1', endNodeId: 'missing' }), /endNodeId/);
  assert.throws(() => call(workspace, 'add_member', { id: 'M1', startNodeId: 'J1', endNodeId: 'J2' }), /duplicate id/);
  assert.throws(() => call(workspace, 'add_member', { id: 'M9', startNodeId: 'J1', endNodeId: 'J1' }), /endpoints/);
  assert.throws(() => parseStaticsWorkspace({ ...workspace, nodes: [...workspace.nodes, { id: 'J2', x: 2, y: 2 }] }), /duplicate id/);
  assert.equal(JSON.stringify(workspace), before);
});

test('creating a described truss publishes one validated structure without solving or editing FBD', () => {
  const starting = createStaticsWorkspace();
  const published = [];
  const batch = executeEngineeringToolBatch(starting, [{ id: 'create-1', name: 'create_structure', arguments: {
    nodes: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 4, y: 0 }, { id: 'C', x: 2, y: 3 }],
    members: [{ id: 'AB', startNodeId: 'A', endNodeId: 'B' },
      { id: 'BC', startNodeId: 'B', endNodeId: 'C' },
      { id: 'AC', startNodeId: 'A', endNodeId: 'C' }],
  } }], (next) => published.push(next), 'Create a triangular truss with joints A, B, and C.');
  assert.equal(batch.results[0].success, true);
  assert.equal(batch.workspace.members.length, 3);
  assert.equal(published.length, 1);
  assert.equal(batch.interactions[0].calculation, undefined);
  assert.equal(batch.outcome.calculation, undefined);
  assert.deepEqual(createEmptyFBDState(batch.workspace).forces, []);
});

test('a model change refreshes FBD selectors while retaining student marks and history data', () => {
  const initial = create(['J1', 'J2']);
  const selected = selectFBDTarget(createEmptyFBDState(initial), { kind: 'body', id: 'structure' }, initial);
  const marked = addFBDForce(selected, { at: { x: 1, y: 0 }, angle: -90, label: 'P' }, initial, 'student-P');
  const changed = call(initial, 'add_node', { id: 'J3', x: 3, y: 2 });
  const associated = associateFBDState(marked, changed);
  assert.deepEqual(associated.forces, marked.forces);
  assert.deepEqual(associated.selectedTarget, marked.selectedTarget);
  assert.ok(fbdTargetOptions(changed).some((item) => item.target.kind === 'joint' && item.target.id === 'J3'));
  assert.ok(!fbdTargetOptions(initial).some((item) => item.target.id === 'J3'));
});
