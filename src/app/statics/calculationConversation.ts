import { explicitlyRequestsCalculation } from './calculationPolicy.ts';

export const CALCULATION_PURPOSE_PROMPT = `Before I calculate it, what do you need this answer for, or how will it help you solve the problem you are working on?`;

export function shouldAskCalculationPurpose(message: string): boolean {
  return explicitlyRequestsCalculation(message);
}

export function buildPurposeGroundedCalculationRequest(originalRequest: string, studentPurpose: string): string {
  const request = originalRequest.trim();
  const purpose = studentPurpose.trim();
  if (!request || !purpose) throw new Error('Both the calculation request and the student purpose are required.');
  return `The student previously made this explicit calculation request:
${request}

The student explained why the answer is needed:
${purpose}

Do not calculate the student's original problem or use its exact numerical data. Create a closely analogous statics problem with the same governing concepts and solution method, but a different scenario, geometry, labels, and numerical values. Solve the analogy completely, show the steps and final answer for the analogy, and then map those steps back to the student's original problem without substituting its data, checking its result, or revealing its final numerical or symbolic answer. Do not invoke a calculation tool against the current engineering or FBD state. Visual output is authorized only when the original request explicitly asked for visual display.`;
}
