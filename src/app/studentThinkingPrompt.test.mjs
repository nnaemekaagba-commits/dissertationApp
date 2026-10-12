import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPurposeGroundedQuestionRequest, buildStudentThinkingRequest, isStudentQuestion,
  QUESTION_PURPOSE_PROMPT, shouldUseEngineeringCanvasContext } from './studentThinkingPrompt.ts';

test('recognizes student questions with and without a question mark', () => {
  assert.equal(isStudentQuestion('Why is this reaction vertical?'), true);
  assert.equal(isStudentQuestion('Calculate the support reactions'), true);
  assert.equal(isStudentQuestion('Explain this moment'), true);
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

test('preserves the original question and the student purpose in the answer request', () => {
  const request = buildPurposeGroundedQuestionRequest(
    'Is this FBD in equilibrium?', 'I need to decide whether my reactions are correct.');
  assert.match(request, /Is this FBD in equilibrium/);
  assert.match(request, /decide whether my reactions are correct/);
  assert.match(request, /answer the original question/i);
});

test('uses engineering canvas context only when the question refers to it', () => {
  assert.equal(shouldUseEngineeringCanvasContext('What is Newton\'s second law?'), false);
  assert.equal(shouldUseEngineeringCanvasContext('How does this FBD reach equilibrium?'), true);
  assert.equal(shouldUseEngineeringCanvasContext('Is the force on my diagram correct?'), true);
  assert.equal(shouldUseEngineeringCanvasContext('Explain this reaction.'), true);
});
