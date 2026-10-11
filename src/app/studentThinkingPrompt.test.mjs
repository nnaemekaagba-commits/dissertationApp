import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStudentThinkingRequest, isStudentQuestion } from './studentThinkingPrompt.ts';

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

test('asks for one problem-specific explanation after answering', () => {
  const request = buildStudentThinkingRequest('Is this FBD in equilibrium?');
  assert.match(request, /exactly one concise, problem-specific question/);
  assert.match(request, /explain what they currently think/);
  assert.match(request, /Do not withhold a directly requested result/);
});
