import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildPurposeGroundedQuestionRequest, buildStudentThinkingRequest, isStudentQuestion,
  QUESTION_PURPOSE_PROMPT, shouldUseEngineeringCanvasContext } from './studentThinkingPrompt.ts';

test('recognizes student questions with and without a question mark', () => {
  assert.equal(isStudentQuestion('Why is this reaction vertical?'), true);
  assert.equal(isStudentQuestion('Calculate the support reactions'), true);
  assert.equal(isStudentQuestion('Explain this moment'), true);
  assert.equal(isStudentQuestion('A 10 kN load acts at midspan. Determine the support reactions.'), true);
  assert.equal(isStudentQuestion('2x + 5 = 17'), true);
});

test('does not interrupt direct canvas actions with a reflection prompt', () => {
  assert.equal(isStudentQuestion('Draw a cantilever FBD'), false);
  assert.equal(isStudentQuestion('Move the force to x = 2 m'), false);
  assert.equal(isStudentQuestion('Clear the diagram'), false);
});

test('answers only after the student purpose has been collected', () => {
  const request = buildStudentThinkingRequest('Is this FBD in equilibrium?');
  assert.match(QUESTION_PURPOSE_PROMPT, /how will this answer help you solve/i);
  assert.match(request, /already explained how this answer will help/i);
  assert.doesNotMatch(request, /ask exactly one/i);
});

test('preserves the question and purpose while requiring a fully solved analogy', () => {
  const request = buildPurposeGroundedQuestionRequest(
    'Is this FBD in equilibrium?', 'I need to decide whether my reactions are correct.');
  assert.match(request, /Is this FBD in equilibrium/);
  assert.match(request, /decide whether my reactions are correct/);
  assert.match(request, /closely analogous problem/i);
  assert.match(request, /change the scenario, names, geometry, and every numerical value/i);
  assert.match(request, /final answer for the analogy/i);
  assert.match(request, /do not substitute the original data/i);
  assert.match(request, /reveal the original problem's final numerical or symbolic answer/i);
  assert.match(request, /do not provide only hints/i);
});

test('direct question requests also teach through an analogy rather than solving exact data', () => {
  const request = buildStudentThinkingRequest('Determine the reactions for a 6 m beam carrying 12 kN.');
  assert.match(request, /closely analogous problem/i);
  assert.match(request, /change the scenario, names, geometry, and all numerical values/i);
  assert.match(request, /Solve the analogous problem completely/i);
  assert.match(request, /without substituting, calculating, checking, or revealing the original problem/i);
});

test('uses engineering canvas context only when the question refers to it', () => {
  assert.equal(shouldUseEngineeringCanvasContext('What is Newton\'s second law?'), false);
  assert.equal(shouldUseEngineeringCanvasContext('How does this FBD reach equilibrium?'), true);
  assert.equal(shouldUseEngineeringCanvasContext('Is the force on my diagram correct?'), true);
  assert.equal(shouldUseEngineeringCanvasContext('Explain this reaction.'), true);
});


test('the app retains uploaded problem files while collecting the student purpose', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  assert.match(app, /files: UploadedFile\[\]/);
  assert.match(app, /answeringQuestionPurpose \? pendingStudentQuestion!\.files : composerFiles/);
  assert.match(app, /setPendingStudentQuestion\(\{ question: displayInput, files: activeImages \}\)/);
});
