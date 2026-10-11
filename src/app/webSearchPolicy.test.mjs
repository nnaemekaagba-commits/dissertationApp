import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWebGroundedRequest, shouldAutomaticallySearchWeb } from './webSearchPolicy.ts';

test('automatically searches for explicit, current, volatile, and high-stakes questions', () => {
  const context = { hasVisibleFBD: false, hasAttachments: false };
  for (const query of ['Search the web for beam design standards', 'What is the latest AISC version?',
    'What is the current steel price?', 'Is this medical treatment safe?'])
    assert.equal(shouldAutomaticallySearchWeb(query, context), true, query);
});

test('keeps canvas, uploaded-problem, and ordinary calculation questions on local tools', () => {
  assert.equal(shouldAutomaticallySearchWeb('Is my FBD missing a support reaction?',
    { hasVisibleFBD: true, hasAttachments: false }), false);
  assert.equal(shouldAutomaticallySearchWeb('Solve the attached problem',
    { hasVisibleFBD: false, hasAttachments: true }), false);
  assert.equal(shouldAutomaticallySearchWeb('Calculate the beam reactions',
    { hasVisibleFBD: false, hasAttachments: false }), false);
});

test('web context requires linked citations and preserves source evidence', () => {
  const prompt = buildWebGroundedRequest('What changed?', [{ title: 'Official update',
    url: 'https://example.test/update', snippet: 'The standard changed.', source: 'Example' }]);
  assert.match(prompt, /Cite factual claims inline with Markdown links/);
  assert.match(prompt, /https:\/\/example\.test\/update/);
  assert.match(prompt, /The standard changed/);
});
