export type AssistantMessageLike = { role: string; content: string };

export const normalizedAssistantContent = (content: string) =>
  content.replace(/\s+/g, ' ').trim();

export const assistantResponseKey = (request: string, response: string) =>
  `${request.replace(/\s+/g, ' ').trim()}\u0000${normalizedAssistantContent(response)}`;

export function dedupeConsecutiveAssistantMessages<T extends AssistantMessageLike>(messages: T[]): T[] {
  return messages.filter((message, index) => {
    if (message.role !== 'assistant' || index === 0) return true;
    const previous = messages[index - 1];
    return previous.role !== 'assistant' ||
      normalizedAssistantContent(previous.content) !== normalizedAssistantContent(message.content);
  });
}
