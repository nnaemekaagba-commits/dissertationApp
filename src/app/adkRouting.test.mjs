import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseADKFBDCoach } from './adkRouting.ts';

const url = 'https://adk.example.com';

test('routes grounded FBD advice to ADK only when configured and a diagram is visible', () => {
  assert.equal(shouldUseADKFBDCoach('Why is this support a pin?', true, url), true);
  assert.equal(shouldUseADKFBDCoach('Am I missing a reaction force?', true, url), true);
  assert.equal(shouldUseADKFBDCoach('Why is this support a pin?', false, url), false);
  assert.equal(shouldUseADKFBDCoach('Why is this support a pin?', true, ''), false);
});

test('keeps diagram mutations and calculations on the existing explicit tool path', () => {
  assert.equal(shouldUseADKFBDCoach('Move force P to x = 2 m', true, url), false);
  assert.equal(shouldUseADKFBDCoach('Delete the moment', true, url), false);
  assert.equal(shouldUseADKFBDCoach('Calculate the support reactions', true, url), false);
  assert.equal(shouldUseADKFBDCoach('Solve this FBD', true, url), false);
});
