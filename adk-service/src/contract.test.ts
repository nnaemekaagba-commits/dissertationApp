import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationPrompt, parseChatRequest } from './contract.js';

test('requires both live diagram states', () => {
  assert.throws(() => parseChatRequest({ message: 'What am I missing?', fbdState: {} }), /engineeringState/);
});

test('keeps the visible question and bounded conversation history', () => {
  const request = parseChatRequest({ message: 'What does this pin contribute?', engineeringState: { nodes: [] },
    fbdState: { members: [] }, conversationHistory: [{ role: 'user', content: 'A beam problem' }] });
  assert.match(conversationPrompt(request), /A beam problem/);
  assert.match(conversationPrompt(request), /What does this pin contribute/);
});
