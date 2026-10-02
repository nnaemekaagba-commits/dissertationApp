import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantResponseKey, dedupeConsecutiveAssistantMessages } from './assistantMessageDedup.ts';

const message = (id, role, content) => ({ id, role, content });

test('consecutive identical assistant responses collapse to one', () => {
  const result = dedupeConsecutiveAssistantMessages([
    message('u1', 'user', 'Explain this'),
    message('a1', 'assistant', 'One clear answer.'),
    message('a2', 'assistant', '  One   clear answer.  '),
  ]);
  assert.deepEqual(result.map(({ id }) => id), ['u1', 'a1']);
});

test('different explanations and replies to later questions remain visible', () => {
  const result = dedupeConsecutiveAssistantMessages([
    message('u1', 'user', 'Explain this'),
    message('a1', 'assistant', 'First explanation.'),
    message('a2', 'assistant', 'Different explanation.'),
    message('u2', 'user', 'Explain this again'),
    message('a3', 'assistant', 'First explanation.'),
  ]);
  assert.equal(result.length, 5);
});

test('response idempotency key includes both request and normalized response', () => {
  assert.equal(assistantResponseKey(' question ', 'same\nanswer'), assistantResponseKey('question', 'same answer'));
  assert.notEqual(assistantResponseKey('question one', 'same answer'), assistantResponseKey('question two', 'same answer'));
});
