import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { createEmptyFBDState, selectFBDTarget, addFBDForce, addFBDMoment,
  addFBDDimension, addFBDAngle, addFBDLabel, editFBDForce } from './fbdState.ts';
import { displayModeLayout } from './displayMode.ts';
import { executeEngineeringToolBatch, formatEngineeringToolBatch } from './engineeringTools.ts';
import { explicitlyRequestsCalculation, explicitlyRequestsVisualCalculation,
  visualCalculationForRequest, visibleCalculation } from './calculationPolicy.ts';

const workspace = createSimplySupportedBeamWorkspace();

test('FBD creation, editing, and view changes do not enter the calculation path', () => {
  let fbd = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
  fbd = addFBDForce(fbd, { at: { x: 2, y: 0 }, angle: -90, label: 'P' }, workspace, 'f');
  fbd = addFBDMoment(fbd, { at: { x: 1, y: 0 }, clockwise: true, label: 'M' }, workspace, 'm');
  fbd = addFBDDimension(fbd, { start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, label: '2 m' }, workspace, 'd');
  fbd = addFBDAngle(fbd, { vertex: { x: 0, y: 0 }, from: { x: 1, y: 0 },
    to: { x: 0, y: 1 }, label: '90°' }, workspace, 'a');
  fbd = addFBDLabel(fbd, { at: { x: 1, y: 1 }, text: 'beam' }, workspace, 'l');
  fbd = editFBDForce(fbd, 'f', { at: { x: 2, y: 0 }, angle: -80, label: 'P' }, workspace);
  for (const mode of ['structure', 'fbd', 'split']) assert.ok(displayModeLayout(mode));
  assert.equal(fbd.forces[0].angle, -80);
  const fbdSource = readFileSync(new URL('./fbdState.ts', import.meta.url), 'utf8');
  const panelSource = readFileSync(new URL('./EngineeringVisualizationPanel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(fbdSource, /from ['"]\.\/calculations/);
  assert.doesNotMatch(panelSource, /calculatePlanarBeamReactions\s*\(/);
  assert.doesNotMatch(panelSource, /import\s*\{\s*calculatePlanarBeamReactions/);
});

test('structural edit and view tools produce no solver data or numerical reply', () => {
  const batch = executeEngineeringToolBatch(workspace, [
    { id: 'edit', name: 'move_load', arguments: { loadId: 'load-C', position: 3 } },
    { id: 'view', name: 'show_view', arguments: { view: 'front' } },
    { id: 'fbd', name: 'show_fbd', arguments: { visible: true } },
  ], undefined, 'Move the load to 3 m and show FBD view.');
  assert.equal(batch.structureChanged, true);
  assert.ok(batch.interactions.every((item) => item.calculation === undefined));
  assert.doesNotMatch(formatEngineeringToolBatch(batch), /Support reactions|Fy =/);
});

test('model-suggested calculation on an edit or view request is rejected', () => {
  for (const message of ['Move the load to 3 m.', 'Show Split View.', 'Add a force arrow to my FBD.']) {
    const batch = executeEngineeringToolBatch(workspace, [
      { id: 'unexpected', name: 'calculate_reactions', arguments: {} },
    ], undefined, message);
    assert.equal(batch.results[0].success, false);
    assert.equal(batch.interactions[0].calculation, undefined);
    assert.doesNotMatch(formatEngineeringToolBatch(batch), /Fy =/);
  }
});

test('explicit calculation returns chat values and shows no visual result by default', () => {
  assert.equal(explicitlyRequestsCalculation('Calculate the reactions.'), true);
  assert.equal(explicitlyRequestsCalculation('How do I calculate reactions?'), false);
  const message = 'Calculate the reactions.';
  const batch = executeEngineeringToolBatch(workspace, [
    { id: 'solve', name: 'calculate_reactions', arguments: {} },
  ], undefined, message);
  assert.equal(batch.results[0].success, true);
  assert.match(formatEngineeringToolBatch(batch), /Support reactions/);
  const result = batch.results[0].result.calculation;
  assert.equal(visualCalculationForRequest(message, workspace, result), null);
  assert.equal(visibleCalculation(workspace, null), null);
});

test('visual result appears only for explicit visual request and expires after a model edit', () => {
  const message = 'Show the reaction arrows on the diagram.';
  assert.equal(explicitlyRequestsVisualCalculation(message), true);
  assert.equal(explicitlyRequestsVisualCalculation('Calculate reactions.'), false);
  const batch = executeEngineeringToolBatch(workspace, [
    { id: 'solve', name: 'calculate_reactions', arguments: {} },
  ], undefined, message);
  const result = batch.results[0].result.calculation;
  const requested = visualCalculationForRequest(message, workspace, result);
  assert.equal(visibleCalculation(workspace, requested), result);
  const edited = executeEngineeringToolBatch(workspace, [
    { id: 'edit', name: 'move_load', arguments: { loadId: 'load-C', position: 3 } },
  ], undefined, 'Move the load to 3 m.');
  assert.equal(visibleCalculation(edited.workspace, requested), null);
});
