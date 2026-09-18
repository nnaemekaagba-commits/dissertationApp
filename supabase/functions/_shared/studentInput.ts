const ATTACHMENT_KEYS = new Set([
  'file', 'files', 'attachments', 'attachment', 'attachmentId', 'attachmentIds',
  'image', 'images', 'imageUrl', 'imageUrls', 'document', 'documents', 'documentId',
  'documentIds', 'documentUrl', 'documentUrls', 'fileId', 'fileIds', 'fileUrl',
  'fileUrls', 'upload', 'uploads', 'inputFiles',
]);

function hasInputReference(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).some(([key, entry]) =>
    ATTACHMENT_KEYS.has(key) && entry !== undefined && entry !== null &&
    !(Array.isArray(entry) && entry.length === 0));
}

function containsInlineAttachment(text: unknown): boolean {
  if (text === undefined || text === null) return false;
  return typeof text !== 'string' || /data:(?:image\/|application\/(?:pdf|octet-stream))/i.test(text) ||
    /<\s*(?:img|object|embed)\b/i.test(text);
}

export function studentAttachmentError(payload: unknown, includeHistory = false,
  checkContent = true): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'Invalid message body';
  const body = payload as Record<string, unknown>;
  if (hasInputReference(body) || (checkContent && containsInlineAttachment(body.message ?? body.content))) {
    return 'Student attachments and document/image inputs are disabled. Use text or voice transcription.';
  }
  if (includeHistory && Array.isArray(body.conversationHistory) && body.conversationHistory.some((item) =>
    hasInputReference(item) || containsInlineAttachment((item as Record<string, unknown>)?.content))) {
    return 'Student attachments and document/image inputs are disabled. Use text or voice transcription.';
  }
  return null;
}
