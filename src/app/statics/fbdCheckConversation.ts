export const FBD_CHECK_QUESTIONS = `Before I help review your FBD, please answer these questions:

1. What questions do you have about your FBD?
2. Can you describe the statics problem you are trying to solve?

I will use your answers together with the current diagram to give you targeted hints. I will not change your FBD or run calculations.`;

export function buildFBDCoachingRequest(studentResponse: string): string {
  const response = studentResponse.trim();
  if (!response) throw new Error('The FBD coaching response is required.');
  return `What follows is a request for coaching about the current student-built free-body diagram.
Use the supplied FBD JSON and the student's problem description below. Apply engineering statics knowledge and give targeted hints that refer to the actual bodies, forces, moments, labels, directions, and locations present in the FBD. Explain what the student should think about next. Ask one concise follow-up question if essential information is missing.

Do not modify the FBD and do not call mutating engineering or FBD tools. If the student's response explicitly requests a calculation, use the appropriate deterministic calculation tool and report its validated result in chat. Do not invent numerical results or substitute a language-model calculation for a tool result. Do not display calculation results in the visualization unless the student explicitly requests visual display. Do not claim an element is missing unless the student's problem description supports that conclusion.

Student's FBD question and problem description:
${response}`;
}
