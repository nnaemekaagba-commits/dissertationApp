import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ANALOGY_CLOSING_SENTENCE, buildPurposeGroundedQuestionRequest, buildStudentThinkingRequest,
  enforceAnalogyOnlyResponse, isStudentQuestion, QUESTION_PURPOSE_PROMPT,
  shouldUseEngineeringCanvasContext } from './studentThinkingPrompt.ts';

test('recognizes student questions with and without a question mark', () => {
  assert.equal(isStudentQuestion('Why is this reaction vertical?'), true);
  assert.equal(isStudentQuestion('Calculate the support reactions'), true);
  assert.equal(isStudentQuestion('Explain this moment'), true);
  assert.equal(isStudentQuestion('A 10 kN load acts at midspan. Determine the support reactions.'), true);
  assert.equal(isStudentQuestion('2x + 5 = 17'), true);
  assert.equal(isStudentQuestion('the value of each interior angle of a hexagon'), true);
});

test('does not interrupt direct canvas actions with a reflection prompt', () => {
  assert.equal(isStudentQuestion('Draw a cantilever FBD'), false);
  assert.equal(isStudentQuestion('Move the force to x = 2 m'), false);
  assert.equal(isStudentQuestion('Clear the diagram'), false);
});

test('FBD drawing actions bypass analogy tutoring before the model request', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  assert.match(app, /!explicitlyRequestsFBDDrawing\(displayInput, activeImages\.length > 0\)\s*\? buildStudentThinkingRequest\(requestContent\) : requestContent/);
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
  assert.match(request, /change the defining object as well as the scenario, names, geometry, and every numerical value/i);
  assert.match(request, /final answer for the analogy/i);
  assert.match(request, /Do not map the steps back, substitute the original data/i);
  assert.match(request, /reveal the original problem's final numerical or symbolic answer/i);
  assert.match(request, /The same method can be applied to your question/i);
  assert.match(request, /Do not map the steps back/i);
  assert.match(request, /do not provide only hints/i);
});

test('direct question requests also teach through an analogy rather than solving exact data', () => {
  const request = buildStudentThinkingRequest('Determine the reactions for a 6 m beam carrying 12 kN.');
  assert.match(request, /closely analogous problem/i);
  assert.match(request, /Change the defining object as well as the scenario, names, geometry, and all numerical values/i);
  assert.match(request, /Solve only the analogous problem completely/i);
  assert.match(request, /Do not map the steps back, substitute the original data, calculate, check, or reveal/i);
});

test('a hexagon request must use a different polygon and never calculate the hexagon', () => {
  const request = buildPurposeGroundedQuestionRequest(
    'What is the value of each interior angle of a regular hexagon?',
    'I need to understand the polygon angle method.');
  assert.match(request, /MANDATORY ANALOGY MODE/);
  assert.match(request, /hexagon request must be demonstrated with a pentagon, octagon, or another non-hexagon/i);
  assert.match(request, /Do not solve, calculate, or state the answer to the exact object/i);
  const server = readFileSync(new URL('../../supabase/functions/server/index.tsx', import.meta.url), 'utf8');
  const deployed = readFileSync(new URL('../../supabase/functions/make-server-09672449/index.ts', import.meta.url), 'utf8');
  assert.match(server, /latest user message contains "MANDATORY ANALOGY MODE"/);
  assert.match(deployed, /latest user message contains "MANDATORY ANALOGY MODE"/);
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

test('removes any attempt to solve the submitted problem after the analogy', () => {
  const response = `## Similar example\nA different beam has reactions of 4 kN.\n\n${ANALOGY_CLOSING_SENTENCE}\n\n## Your problem\nThe submitted beam reactions are 6 kN.`;
  const bounded = enforceAnalogyOnlyResponse(response);
  assert.match(bounded, /different beam has reactions of 4 kN/);
  assert.equal(bounded.endsWith(ANALOGY_CLOSING_SENTENCE), true);
  assert.doesNotMatch(bounded, /submitted beam|6 kN/);
});

test('cuts original-problem transitions when the model omits the closing sentence', () => {
  const bounded = enforceAnalogyOnlyResponse('The analogous triangle gives 30°.\n\n### Applying this to your problem\nThe answer is 120°.');
  assert.match(bounded, /analogous triangle gives 30°/);
  assert.doesNotMatch(bounded, /120°|Applying this to your problem/);
  assert.equal(bounded.endsWith(ANALOGY_CLOSING_SENTENCE), true);
});
