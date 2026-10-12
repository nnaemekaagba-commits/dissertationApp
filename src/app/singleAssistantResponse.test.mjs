import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSingleResponseInstruction, collapseRepeatedAssistantContent,
  upsertAssistantReply } from './singleAssistantResponse.ts';

test('collapses an identical answer repeated inside one provider payload', () => {
  assert.equal(collapseRepeatedAssistantContent('First point.\n\nSecond point.\n\nFirst point.\n\nSecond point.'),
    'First point.\n\nSecond point.');
  assert.equal(collapseRepeatedAssistantContent('One answer.\nOne answer.'), 'One answer.');
});

test('keeps genuinely different sections in one answer', () => {
  const content = 'Explanation.\n\nWhat do you think?';
  assert.equal(collapseRepeatedAssistantContent(content), content);
});

test('keeps only the first model-generated numbered response', () => {
  const content = `## Response 1

The force points down.

## Reflective Question

What does that direction mean?

---

## Response 2

There are two forces.`;
  const result = collapseRepeatedAssistantContent(content);
  assert.doesNotMatch(result, /Response 1|Response 2|There are two forces/);
  assert.match(result, /The force points down/);
  assert.match(result, /Reflective Question/);
});

test('the model request explicitly permits only one integrated answer', () => {
  const request = buildSingleResponseInstruction('Explain my FBD.');
  assert.match(request, /Return exactly one integrated answer/);
  assert.match(request, /Never produce sections called Response 1, Response 2/);
});

test('a retry replaces the prior answer for the same student turn', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'Question' },
    { id: 'a1', role: 'assistant', content: 'Old', replyToMessageId: 'u1' },
  ];
  const result = upsertAssistantReply(messages,
    { id: 'a1', role: 'assistant', content: 'New', replyToMessageId: 'u1' });
  assert.deepEqual(result.map((item) => item.content), ['Question', 'New']);
});
