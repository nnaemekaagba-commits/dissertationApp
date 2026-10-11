import assert from 'node:assert/strict';
import test from 'node:test';
import { CALCULATION_PURPOSE_PROMPT, buildPurposeGroundedCalculationRequest,
  shouldAskCalculationPurpose } from './calculationConversation.ts';
import { explicitlyRequestsCalculation } from './calculationPolicy.ts';

test('explicit calculation requests require a purpose prompt before execution', () => {
  assert.equal(shouldAskCalculationPurpose('Calculate the support reactions.'), true);
  assert.match(CALCULATION_PURPOSE_PROMPT, /what do you need this answer for/i);
  assert.match(CALCULATION_PURPOSE_PROMPT, /how will it help/i);
});

test('method questions and canvas edits do not start the calculation gate', () => {
  assert.equal(shouldAskCalculationPurpose('How do I calculate reactions?'), false);
  assert.equal(shouldAskCalculationPurpose('Move the load to 3 m.'), false);
});

test('the follow-up preserves purpose and explicit calculator authorization', () => {
  const request = buildPurposeGroundedCalculationRequest(
    'Calculate the support reactions.', 'I need them to check my FBD equilibrium.');
  assert.match(request, /check my FBD equilibrium/);
  assert.match(request, /deterministic statics calculation tool/);
  assert.equal(explicitlyRequestsCalculation(request), true);
});
