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

Now use the appropriate deterministic statics calculation tool to perform the original requested calculation. Base it on the current engineering and FBD state. Return the validated calculation result in chat. Visual output is authorized only when the original request explicitly asked for visual display.`;
}
