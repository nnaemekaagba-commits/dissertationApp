export type TurnMessage = { id: string; role: string; content: string; replyToMessageId?: string };

const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Removes an exact repeated half occasionally returned inside one provider payload. */
export function collapseRepeatedAssistantContent(content: string): string {
  let text = content.trim();
  const secondResponse = text.search(/^\s*(?:#{1,6}\s*)?(?:\*\*|__)?Response\s+(?:2|Two)(?:\*\*|__)?\s*:?[ \t]*$/im);
  if (secondResponse >= 0) text = text.slice(0, secondResponse).replace(/\n\s*(?:---+|\*\*\*+)\s*$/i, '').trim();
  text = text.replace(/^\s*(?:#{1,6}\s*)?(?:\*\*|__)?Response\s+(?:1|One)(?:\*\*|__)?\s*:?[ \t]*\r?\n+/im, '').trim();
  const paragraphs = text.split(/\n\s*\n/);
  if (paragraphs.length >= 2 && paragraphs.length % 2 === 0) {
    const middle = paragraphs.length / 2;
    const first = paragraphs.slice(0, middle).join('\n\n');
    const second = paragraphs.slice(middle).join('\n\n');
    if (normalized(first) === normalized(second)) return first;
  }
  const lines = text.split('\n');
  if (lines.length >= 2 && lines.length % 2 === 0) {
    const middle = lines.length / 2;
    const first = lines.slice(0, middle).join('\n');
    const second = lines.slice(middle).join('\n');
    if (normalized(first) === normalized(second)) return first.trim();
  }
  return text;
}

export function buildSingleResponseInstruction(message: string): string {
  return `${message}

RESPONSE COUNT RULE:
Return exactly one integrated answer. Never produce sections called Response 1, Response 2, alternative response, or a second answer. A reflective question may appear at the end of that same answer.`;
}

/** One ordinary assistant answer owns each student turn; retries replace that answer. */
export function upsertAssistantReply<T extends TurnMessage>(messages: T[], reply: T): T[] {
  if (reply.role !== 'assistant' || !reply.replyToMessageId) return [...messages, reply];
  const withoutPriorReply = messages.filter((message) =>
    message.role !== 'assistant' || message.replyToMessageId !== reply.replyToMessageId);
  return [...withoutPriorReply, reply];
}
