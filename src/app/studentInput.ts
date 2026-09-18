export type InputModality = 'text' | 'audio';
export type TranscriptionSource = 'browser-speech' | 'recorded-audio';

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
  transfer: Pick<DataTransfer, 'files' | 'items' | 'types'> | null | undefined,
): boolean {
  if (!transfer) return false;
  return transfer.files.length > 0 ||
    Array.from(transfer.items).some((item) => item.kind === 'file') ||
    Array.from(transfer.types).includes('Files');
}
