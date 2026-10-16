const questionOpening = /^(what|why|how|when|where|which|who|can|could|would|should|is|are|am|do|does|did|will|may|help|explain|solve|calculate|find|determine)\b/i;
const directCanvasAction = /^(add|create|draw|edit|move|delete|remove|clear|reset|show|open|close|save|upload|switch|change)\b/i;
const explicitCanvasReference = /\b(fbd|free[ -]?body(?: diagram)?|rigid[ -]?body(?: view| diagram)?|canvas|diagram|shown here)\b/i;
const referencedCanvasElement = /\b(?:this|that|my|the current)\s+(?:member|beam|body|force|load|moment|reaction|support)\b/i;
const problemStatement = /\b(solve|calculate|find|determine|compute|evaluate|derive|prove|given|unknown|equilibrium|reaction|resultant)\b|(?:\d|[a-z])\s*[=+*/^]\s*(?:\d|[a-z])/i;
const answerSeekingStatement = /^(?:please\s+)?(?:the\s+)?(?:value|answer|solution|result|measure)\b|\b(?:value|measure|sum)\s+of\b|\b(?:interior|exterior)\s+angles?\s+(?:of|in|for)\b/i;

export function isStudentQuestion(message: string): boolean {
  const text = message.trim();
  if (!text || directCanvasAction.test(text)) return false;
  return text.includes('?') || questionOpening.test(text) || problemStatement.test(text) || answerSeekingStatement.test(text);
}

export function shouldUseEngineeringCanvasContext(message: string): boolean {
  const text = message.trim();
  return explicitCanvasReference.test(text) || referencedCanvasElement.test(text);
}

export function buildStudentThinkingRequest(message: string): string {
  if (!isStudentQuestion(message)) return message;
  return `${message}

MANDATORY ANALOGY MODE:
The student has already explained how this answer will help with the problem they are solving. Do not solve, calculate, or state the answer to the exact object or problem the student named. Teach the method through one closely analogous problem. Change the defining object as well as the scenario, names, geometry, and all numerical values while preserving the same concept and solution method. For example, if the student asks about a hexagon, work a different polygon such as a pentagon or octagon; never calculate a hexagon in the analogy. Solve only the analogous problem completely, with step-by-step reasoning, assumptions, calculations, and a clearly identified final answer for the analogy. End with exactly this sentence: "The same method can be applied to your question." Do not write anything after it. Do not map the steps back, substitute the original data, calculate, check, or reveal the original problem's answer. Do not provide only hints unless the student explicitly requested hints only.`;
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

MANDATORY ANALOGY MODE:
Use the student's purpose to make the explanation relevant. Do not solve, calculate, or state the answer to the exact object or problem the student named. Create one closely analogous problem with the same concepts and method, but change the defining object as well as the scenario, names, geometry, and every numerical value. For polygon questions, use a polygon with a different number of sides: a hexagon request must be demonstrated with a pentagon, octagon, or another non-hexagon. Solve only the analogy completely with step-by-step reasoning, assumptions, calculations, and a clearly identified final answer for the analogy. End with exactly this sentence: "The same method can be applied to your question." Do not write anything after it. Do not map the steps back, substitute the original data, calculate or verify the original result, reproduce an answer found in an upload, or reveal the original problem's final numerical or symbolic answer. Do not provide only hints unless the student explicitly asked for hints only.`;
}

export const ANALOGY_CLOSING_SENTENCE = 'The same method can be applied to your question.';

export function enforceAnalogyOnlyResponse(response: string): string {
  const text = response.trim();
  const closing = /the same method can be applied to (?:your|the student(?:'s|’s)) question\.?/i.exec(text);
  if (closing) return `${text.slice(0, closing.index).trimEnd()}\n\n${ANALOGY_CLOSING_SENTENCE}`.trim();
  const transition = /\n\s*(?:#{1,6}\s*)?(?:applying (?:it|this|the method)|apply (?:it|this|the method)|your (?:original )?(?:problem|question)|solution (?:to|for) your|now (?:solve|calculate|substitute)|for your (?:original )?(?:problem|question))\b/i.exec(text);
  const analogy = transition ? text.slice(0, transition.index).trimEnd() : text;
  return `${analogy}\n\n${ANALOGY_CLOSING_SENTENCE}`.trim();
}
