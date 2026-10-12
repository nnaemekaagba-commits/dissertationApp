import assert from 'node:assert/strict';
import test from 'node:test';
import { collapseRepeatedAssistantContent, upsertAssistantReply } from './singleAssistantResponse.ts';

test('collapses an identical answer repeated inside one provider payload', () => {
  assert.equal(collapseRepeatedAssistantContent('First point.\n\nSecond point.\n\nFirst point.\n\nSecond point.'),
    'First point.\n\nSecond point.');
  assert.equal(collapseRepeatedAssistantContent('One answer.\nOne answer.'), 'One answer.');
});

test('keeps genuinely different sections in one answer', () => {
  const content = 'Explanation.\n\nWhat do you think?';
  assert.equal(collapseRepeatedAssistantContent(content), content);
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
