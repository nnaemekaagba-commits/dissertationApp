import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimplySupportedBeamWorkspace } from './model.ts';
import { createEmptyFBDState, selectFBDTarget, addFBDForce, addFBDMoment,
  createFBDHistory } from './fbdState.ts';
import { checkStudentFBD, explicitlyRequestsFBDCheck, formatFBDCheckFeedback } from './checkFBD.ts';
import { createFBDCheckResearchEvent } from './researchLog.ts';

const workspace = createSimplySupportedBeamWorkspace();
const empty = selectFBDTarget(createEmptyFBDState(workspace), { kind: 'body', id: 'structure' }, workspace);
const force = (state, id, x, angle, label, magnitude) => addFBDForce(state,
  { at: { x, y: 0 }, angle, label, ...(magnitude === undefined ? {} : { magnitude }) }, workspace, id);
const correct = () => {
  let state = force(empty, 'load', 2, -90, 'P', 10);
  state = force(state, 'Ax', 0, 0, 'A_x');
  state = force(state, 'Ay', 0, 90, 'A_y');
  return force(state, 'By', 4, 90, 'B_y');
};

test('an explicitly requested check recognizes a correct beam FBD without changing state or history', () => {
  const state = correct();
  const history = createFBDHistory(state);
  const structureBefore = JSON.stringify(workspace);
  const fbdBefore = JSON.stringify(state);
  const check = checkStudentFBD(workspace, history.present);
  assert.equal(check.status, 'no_discrepancies');
  assert.deepEqual(check.issues, []);
  assert.deepEqual(check.checked, { appliedForces: 1, appliedMoments: 0, supportForceComponents: 3, supportMoments: 0 });
  assert.equal(JSON.stringify(workspace), structureBefore);
  assert.equal(JSON.stringify(state), fbdBefore);
  assert.equal(history.past.length, 0);
  assert.doesNotMatch(formatFBDCheckFeedback(check), /5 kN|reaction value:/);
  const feedback = formatFBDCheckFeedback(check);
  const event = createFBDCheckResearchEvent('session-1', 'Check My FBD', state, check, feedback,
    () => 'check-1', () => '2026-09-19T12:00:00.000Z');
  assert.equal(event.kind, 'fbd_check');
  assert.deepEqual(event.fbdState, state);
  assert.deepEqual(event.comparisonResult, check);
  assert.equal(event.feedback, feedback);
});

test('checker finds omitted applied load and missing pin and roller reactions', () => {
  const check = checkStudentFBD(workspace, empty);
  assert.equal(check.status, 'needs_revision');
  assert.equal(check.issues.filter((issue) => issue.kind === 'omitted_applied_load').length, 1);
  assert.equal(check.issues.filter((issue) => issue.kind === 'missing_force').length, 3);
});

test('roller arrow on the wrong axis is identified as incorrect reaction representation', () => {
  let state = force(empty, 'load', 2, -90, 'P');
  state = force(state, 'Ax', 0, 0, 'A_x');
  state = force(state, 'Ay', 0, 90, 'A_y');
  state = force(state, 'wrong-B', 4, 0, 'B_x');
  const check = checkStudentFBD(workspace, state);
  assert.ok(check.issues.some((issue) => issue.kind === 'incorrect_support_reaction' &&
    issue.elementId === 'wrong-B'));
});

test('checker distinguishes wrong given direction and extra force without revealing reactions', () => {
  let state = force(empty, 'wrong-load', 2, 90, 'P');
  state = force(state, 'Ax', 0, 180, 'A_x');
  state = force(state, 'Ay', 0, -90, 'A_y');
  state = force(state, 'By', 4, 270, 'B_y');
  state = force(state, 'extra', 3, 0, 'Q');
  const check = checkStudentFBD(workspace, state);
  assert.ok(check.issues.some((issue) => issue.kind === 'incorrect_force_direction'));
  assert.ok(check.issues.some((issue) => issue.kind === 'extra_force' && issue.elementId === 'extra'));
  assert.equal(check.issues.filter((issue) => issue.kind === 'incorrect_support_reaction').length, 0);
  assert.doesNotMatch(formatFBDCheckFeedback(check), /5 kN/);
});

test('applied and fixed-support moments are checked without solving their magnitude', () => {
  const problem = { ...workspace,
    supports: [{ id: 'fixed-A', nodeId: 'A', kind: 'fixed' }],
    loads: [{ id: 'given-M', kind: 'moment', nodeId: 'C', magnitude: 8 }] };
  let state = selectFBDTarget(createEmptyFBDState(problem), { kind: 'body', id: 'structure' }, problem);
  let check = checkStudentFBD(problem, state);
  assert.equal(check.issues.filter((issue) => issue.kind === 'missing_moment').length, 2);
  state = addFBDMoment(state, { at: { x: 2, y: 0 }, clockwise: true, label: 'M' }, problem, 'wrong-M');
  state = addFBDMoment(state, { at: { x: 0, y: 0 }, clockwise: false, label: 'M_A' }, problem, 'reaction-M');
  check = checkStudentFBD(problem, state);
  assert.ok(check.issues.some((issue) => issue.kind === 'incorrect_moment_direction'));
  assert.equal(check.issues.filter((issue) => issue.kind === 'missing_moment').length, 0);
});

test('distributed loads and joint interaction forces are reported as limits, never guessed', () => {
  const problem = { ...workspace, loads: [{ id: 'w', kind: 'distributed', memberId: 'AB',
    startMagnitude: 2, endMagnitude: 2, angle: -90 }] };
  const state = selectFBDTarget(createEmptyFBDState(problem), { kind: 'body', id: 'structure' }, problem);
  const check = checkStudentFBD(problem, state);
  assert.ok(check.limitations.some((item) => item.includes('Distributed load')));
  assert.ok(!check.issues.some((issue) => issue.kind === 'omitted_applied_load'));
  const joint = selectFBDTarget(state, { kind: 'joint', id: 'A' }, problem);
  assert.ok(checkStudentFBD(problem, joint).limitations.some((item) => item.includes('member-end')));
});

test('only an explicit checking request starts the checker', () => {
  for (const message of ['Check My FBD', 'Please review my free-body diagram.', 'Can you check my FBD?'])
    assert.equal(explicitlyRequestsFBDCheck(message), true);
  for (const message of ['Am I missing anything?', 'How do I check my FBD?', 'Do not check my FBD yet.',
    'What does a pin support contribute?']) assert.equal(explicitlyRequestsFBDCheck(message), false);
});

test('visible scratch geometry overrides a stale selected problem member', () => {
  const state = { ...empty,
    selectedTarget: { kind: 'member', id: 'AB' },
    bodies: [{ id: 'body-AD', label: 'AD', origin: { x: 0, y: 0 }, width: 4, height: 0.4 }],
    forces: [{ id: 'student-force', at: { x: 2, y: 0 }, angle: -90, label: 'P' }] };
  const check = checkStudentFBD(workspace, state);
  assert.ok(!check.issues.some((issue) => issue.kind === 'diagram_context_mismatch'));
  assert.equal(check.checked.appliedForces, 1);
  assert.ok(check.issues.some((issue) => issue.kind === 'missing_support_definition'));
});

test('visible matching scratch member uses translated structure instead of legacy loads', () => {
  const state = { ...empty,
    selectedTarget: { kind: 'member', id: 'AB' },
    members: [{ id: 'student-AB', label: 'AB', start: { x: 0, y: 0 }, end: { x: 4, y: 0 } }] };
  const check = checkStudentFBD(workspace, state);
  assert.notEqual(check.status, 'limited');
  assert.ok(!check.issues.some((issue) => issue.kind === 'diagram_context_mismatch'));
  assert.ok(!check.issues.some((issue) => issue.kind === 'omitted_applied_load'));
  assert.ok(check.issues.some((issue) => issue.kind === 'missing_support_definition'));
  assert.ok(check.limitations.some((item) => item.includes('translated from this student-created diagram')));
});

test('a single selected student body is inferred without the optional problem-object selector', () => {
  const state = { ...empty, selectedTarget: null,
    bodies: [{ id: 'body-AB', label: 'AB', origin: { x: 0, y: 0 }, width: 4, height: 0.4 }] };
  const check = checkStudentFBD(workspace, state);
  assert.deepEqual(check.selectedTarget, { kind: 'body', id: 'structure' });
  assert.ok(!check.issues.some((issue) => issue.kind === 'select_target'));
  assert.ok(!check.issues.some((issue) => issue.kind === 'omitted_applied_load'));
  assert.ok(check.limitations.some((item) => item.includes('omitted problem loads cannot be verified')));
});

test('a single student member is matched to the engineering member by endpoint label', () => {
  const state = { ...empty, selectedTarget: null,
    members: [{ id: 'student-member', label: 'AB', start: { x: 0, y: 0 }, end: { x: 4, y: 0 } }] };
  const check = checkStudentFBD(workspace, state);
  assert.deepEqual(check.selectedTarget, { kind: 'member', id: 'AB' });
  assert.ok(!check.issues.some((issue) => issue.kind === 'select_target'));
});

test('scratch body check uses its translated supports and external loads instead of legacy node names', () => {
  const state = { ...empty, selectedTarget: null,
    bodies: [{ id: 'body-CD', label: 'CD', origin: { x: 0, y: 0 }, width: 4, height: 0.4,
      startJointKind: 'pin' }],
    forces: [
      { id: 'external', at: { x: 2, y: 0 }, angle: -90, label: 'P', magnitude: 5 },
      { id: 'Cx', at: { x: 0, y: 0.2 }, angle: 0, label: 'C_x', role: 'reaction' },
      { id: 'Cy', at: { x: 0, y: 0.2 }, angle: 90, label: 'C_y', role: 'reaction' },
    ] };
  const check = checkStudentFBD(workspace, state);
  assert.ok(!check.issues.some((issue) => issue.kind === 'diagram_context_mismatch' || issue.kind === 'select_target'));
  assert.equal(check.checked.appliedForces, 1);
  assert.equal(check.checked.supportForceComponents, 2);
  assert.ok(check.limitations.some((item) => item.includes('translated from this student-created diagram')));
});

test('scratch body check reports a missing reaction from its selected endpoint support', () => {
  const state = { ...empty, selectedTarget: null,
    bodies: [{ id: 'body-CD', label: 'CD', origin: { x: 0, y: 0 }, width: 4, height: 0.4,
      endJointKind: 'roller' }], forces: [] };
  const check = checkStudentFBD(workspace, state);
  assert.ok(check.issues.some((issue) => issue.kind === 'missing_force' && issue.description.includes('Roller')));
  assert.ok(!check.issues.some((issue) => issue.kind === 'diagram_context_mismatch'));
});

test('scratch checker recognizes marked reactions as translated supports without contradictory feedback', () => {
  const state = { ...empty, selectedTarget: null,
    bodies: [{ id: 'body-BD', label: 'BD', origin: { x: 0, y: 0 }, width: 4, height: 0.4 }],
    forces: [
      { id: 'reaction-B', at: { x: 0, y: 0.2 }, angle: 0, label: 'B_x', magnitude: 6, role: 'reaction' },
      { id: 'reaction-D', at: { x: 4, y: 0.2 }, angle: 0, label: 'D_x', magnitude: 2.6, role: 'reaction' },
      { id: 'external', at: { x: 2, y: 0.2 }, angle: -90, label: 'P', magnitude: 5, role: 'applied' },
    ] };
  const check = checkStudentFBD(workspace, state);
  assert.equal(check.checked.supportForceComponents, 2);
  assert.equal(check.checked.appliedForces, 1);
  assert.ok(!check.issues.some((issue) => issue.kind === 'missing_support_definition'));
  assert.ok(!check.issues.some((issue) => issue.kind === 'extra_force' && issue.elementId?.startsWith('reaction-')));
  assert.ok(check.limitations.some((item) => item.includes('Support symbols were inferred')));
  const feedback = formatFBDCheckFeedback(check);
  assert.match(feedback, /current FBD canvas/);
  assert.match(feedback, /Body BD is the base object on the canvas/);
  assert.match(feedback, /At \(0, 0\.2\), B_x \(entered 6 kN\) pointing right/);
  assert.match(feedback, /At \(4, 0\.2\), D_x \(entered 2\.6 kN\) pointing right/);
  assert.match(feedback, /Applied force P \(entered 5 kN\) pointing down is located at \(2, 0\.2\)/);
});

test('scratch checker explains missing support metadata and legacy force classification', () => {
  const noSupport = { ...empty, selectedTarget: null,
    bodies: [{ id: 'body-CD', label: 'CD', origin: { x: 0, y: 0 }, width: 4, height: 0.4 }],
    forces: [{ id: 'legacy-force', at: { x: 0, y: 0 }, angle: 0, label: 'F' }] };
  let check = checkStudentFBD(workspace, noSupport);
  assert.ok(check.issues.some((issue) => issue.kind === 'missing_support_definition' &&
    issue.description.includes('Body CD')));
  check = checkStudentFBD(workspace, { ...noSupport,
    bodies: [{ ...noSupport.bodies[0], startJointKind: 'fixed' }] });
  assert.ok(check.issues.some((issue) => issue.kind === 'unclassified_reaction' &&
    issue.description.includes('Force type')));
});
