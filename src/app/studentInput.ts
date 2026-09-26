export type InputModality = 'text' | 'audio';
export type TranscriptionSource = 'browser-speech' | 'recorded-audio';
export const STUDENT_INPUT_NOTICE = 'For this activity, please communicate by typing or using voice input.';
export const IMAGE_PASTE_NOTICE = 'Paste an image from your clipboard. Documents and other files are not supported.';

export function pastedImageFiles(
  transfer: Pick<DataTransfer, 'files' | 'items'> | null | undefined,
): File[] {
  if (!transfer) return [];
  const direct = Array.from(transfer.files).filter((file) => file.type.startsWith('image/'));
  if (direct.length) return direct;
  return Array.from(transfer.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

export function createStudentMessageInput(
  content: string,
  inputModality: InputModality,
  transcriptionSource?: TranscriptionSource,
) {
  const text = content.trim();
  if (!text) throw new Error('Student message must contain text.');
  if (inputModality === 'audio' && !transcriptionSource) {
    throw new Error('Audio input must be transcribed before sending.');
  }
  return {
    content: text,
    inputModality,
    transcriptionSource: inputModality === 'audio' ? transcriptionSource : undefined,
  };
}

export function hasTransferredFiles(
  transfer: Pick<DataTransfer, 'files' | 'items' | 'types'> & Partial<Pick<DataTransfer, 'getData'>> | null | undefined,
): boolean {
  if (!transfer) return false;
  const types = Array.from(transfer.types);
  if (transfer.files.length > 0 || Array.from(transfer.items).some((item) => item.kind === 'file') ||
    types.some((type) => type === 'Files' || type.startsWith('image/'))) return true;
  // Some browsers expose dragged/copied images as HTML or URLs without a File item.
  const html = transfer.getData?.('text/html') || '';
  return /<\s*(?:img|object|embed)\b/i.test(html) ||
    /data:image\//i.test(html) ||
    (types.includes('text/uri-list') && /(?:data:image\/|\.(?:png|jpe?g|gif|webp|svg|heic|pdf|docx?|xlsx?|pptx?)(?:[?#]|$))/i
      .test(transfer.getData?.('text/uri-list') || ''));
}
