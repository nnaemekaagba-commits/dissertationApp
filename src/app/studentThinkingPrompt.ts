const questionOpening = /^(what|why|how|when|where|which|who|can|could|would|should|is|are|am|do|does|did|will|may|help|explain|solve|calculate|find|determine)\b/i;
const directCanvasAction = /^(add|create|draw|edit|move|delete|remove|clear|reset|show|open|close|save|upload|switch|change)\b/i;
const explicitCanvasReference = /\b(fbd|free[ -]?body(?: diagram)?|rigid[ -]?body(?: view| diagram)?|canvas|diagram|shown here)\b/i;
const referencedCanvasElement = /\b(?:this|that|my|the current)\s+(?:member|beam|body|force|load|moment|reaction|support)\b/i;
const problemStatement = /\b(solve|calculate|find|determine|compute|evaluate|derive|prove|given|unknown|equilibrium|reaction|resultant)\b|(?:\d|[a-z])\s*[=+*/^]\s*(?:\d|[a-z])/i;

export function isStudentQuestion(message: string): boolean {
  const text = message.trim();
  if (!text || directCanvasAction.test(text)) return false;
  return text.includes('?') || questionOpening.test(text) || problemStatement.test(text);
}

export function shouldUseEngineeringCanvasContext(message: string): boolean {
  const text = message.trim();
  return explicitCanvasReference.test(text) || referencedCanvasElement.test(text);
}

export function buildStudentThinkingRequest(message: string): string {
  if (!isStudentQuestion(message)) return message;
  return `${message}

TUTORING INSTRUCTION:
The student has already explained how this answer will help with the problem they are solving. Teach the method through a closely analogous problem instead of solving the student's exact problem. Change the scenario, names, geometry, and all numerical values while preserving the same underlying concepts and solution method. Solve the analogous problem completely, with step-by-step reasoning, assumptions, calculations, and a clearly identified final answer for the analogy. Then explain how the student can transfer each step to the original problem without substituting, calculating, checking, or revealing the original problem's final numerical or symbolic answer. Do not provide only hints or guiding questions unless the student explicitly requested hints only.`;
}

export const QUESTION_PURPOSE_PROMPT = `Before I answer, how will this answer help you solve the problem you are working on?`;

export function buildPurposeGroundedQuestionRequest(originalQuestion: string, studentPurpose: string): string {
  const question = originalQuestion.trim();
  const purpose = studentPurpose.trim();
  if (!question || !purpose) throw new Error('Both the student question and its purpose are required.');
  return `The student previously asked:
${question}

Before answering, the student explained how the answer will help with their current problem:
${purpose}

Use the student's purpose to make the explanation relevant. Create a closely analogous problem that uses the same concepts and solution method, but change the scenario, names, geometry, and every numerical value. Solve that analogous problem completely with step-by-step reasoning, necessary assumptions, calculations, and a clearly identified final answer for the analogy. Then map the method back to the student's original problem so the student knows which steps to perform. Do not substitute the original data, calculate or verify the original result, reproduce an answer found in the upload, or reveal the original problem's final numerical or symbolic answer. Do not provide only hints, prompts, or partial guidance unless the student explicitly asked for hints only.`;
}
