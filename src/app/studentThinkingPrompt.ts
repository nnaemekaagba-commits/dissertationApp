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
Respond to the student's actual question with a useful explanation or requested calculation. Then ask exactly one concise, problem-specific question that invites the student to explain what they currently think about this problem and why. Refer to the given problem, uploaded material, FBD, or rigid-body information already available. Do not ask them to repeat information already shown. Do not withhold a directly requested result merely to ask the reflection question.`;
}
