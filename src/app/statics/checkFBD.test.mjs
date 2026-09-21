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

test('checker refuses to assess scratch geometry against a different selected member', () => {
  const state = { ...empty,
    selectedTarget: { kind: 'member', id: 'AB' },
    bodies: [{ id: 'body-AD', label: 'AD', origin: { x: 0, y: 0 }, width: 4, height: 0.4 }],
    forces: [{ id: 'student-force', at: { x: 2, y: 0 }, angle: -90, label: 'P' }] };
  const check = checkStudentFBD(workspace, state);
  assert.equal(check.status, 'limited');
  assert.equal(check.checked.appliedForces, 0);
  assert.ok(check.issues.some((issue) => issue.kind === 'diagram_context_mismatch' &&
    issue.description.includes('AD') && issue.description.includes('AB')));
  assert.ok(check.limitations.some((item) => item.includes('wrong object')));
  assert.doesNotMatch(formatFBDCheckFeedback(check), /missing from your FBD|needs a .*reaction/);
});

test('checker continues when scratch geometry matches the selected problem member', () => {
  const state = { ...empty,
    selectedTarget: { kind: 'member', id: 'AB' },
    members: [{ id: 'student-AB', label: 'AB', start: { x: 0, y: 0 }, end: { x: 4, y: 0 } }] };
  const check = checkStudentFBD(workspace, state);
  assert.notEqual(check.status, 'limited');
  assert.ok(!check.issues.some((issue) => issue.kind === 'diagram_context_mismatch'));
  assert.ok(check.issues.some((issue) => issue.kind === 'omitted_applied_load'));
});

test('a single selected student body is inferred without the optional problem-object selector', () => {
  const state = { ...empty, selectedTarget: null,
    bodies: [{ id: 'body-AB', label: 'AB', origin: { x: 0, y: 0 }, width: 4, height: 0.4 }] };
  const check = checkStudentFBD(workspace, state);
  assert.deepEqual(check.selectedTarget, { kind: 'body', id: 'structure' });
  assert.ok(!check.issues.some((issue) => issue.kind === 'select_target'));
  assert.ok(check.issues.some((issue) => issue.kind === 'omitted_applied_load'));
});

test('a single student member is matched to the engineering member by endpoint label', () => {
  const state = { ...empty, selectedTarget: null,
    members: [{ id: 'student-member', label: 'AB', start: { x: 0, y: 0 }, end: { x: 4, y: 0 } }] };
  const check = checkStudentFBD(workspace, state);
  assert.deepEqual(check.selectedTarget, { kind: 'member', id: 'AB' });
  assert.ok(!check.issues.some((issue) => issue.kind === 'select_target'));
});
