const questionOpening = /^(what|why|how|when|where|which|who|can|could|would|should|is|are|am|do|does|did|will|may|help|explain|solve|calculate|find|determine)\b/i;
const directCanvasAction = /^(add|create|draw|edit|move|delete|remove|clear|reset|show|open|close|save|upload|switch|change)\b/i;

export function isStudentQuestion(message: string): boolean {
  const text = message.trim();
  if (!text || directCanvasAction.test(text)) return false;
  return text.includes('?') || questionOpening.test(text);
}

export function buildStudentThinkingRequest(message: string): string {
  if (!isStudentQuestion(message)) return message;
  return `${message}

TUTORING INSTRUCTION:
The student has already explained how this answer will help with the problem they are solving. Respond to the original question now. Use that purpose, the conversation, uploaded material, FBD, and rigid-body information already available. Give one useful, problem-specific answer.`;
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

Now answer the original question. Use the student's purpose to make the explanation relevant to the problem they are solving.`;
}
