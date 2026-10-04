export type DiagramSnapshot = {
  engineeringState: Record<string, unknown>;
  fbdState: Record<string, unknown>;
};

export type ChatRequest = DiagramSnapshot & {
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: unknown }>;
};

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function parseChatRequest(value: unknown): ChatRequest {
  if (!record(value) || typeof value.message !== 'string' || !value.message.trim() ||
    !record(value.engineeringState) || !record(value.fbdState))
    throw new Error('message, engineeringState, and fbdState are required.');
  const history = value.conversationHistory;
  if (history !== undefined && (!Array.isArray(history) || history.length > 40))
    throw new Error('conversationHistory must contain at most 40 messages.');
  return {
    message: value.message.trim().slice(0, 20_000),
    engineeringState: value.engineeringState,
    fbdState: value.fbdState,
    conversationHistory: Array.isArray(history) ? history.flatMap((item) => {
      if (!record(item) || (item.role !== 'user' && item.role !== 'assistant')) return [];
      const content = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
      return [{ role: item.role, content: content.slice(0, 8_000) }];
    }) : [],
  };
}

export function conversationPrompt(request: ChatRequest): string {
  const history = (request.conversationHistory || [])
    .map((item) => `${item.role === 'assistant' ? 'Assistant' : 'Student'}: ${String(item.content)}`)
    .join('\n\n');
  return [history, `Student's current question: ${request.message}`].filter(Boolean).join('\n\n');
}
