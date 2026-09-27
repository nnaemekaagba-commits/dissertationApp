import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createStudentMessageInput, hasTransferredFiles, pastedImageFiles, IMAGE_PASTE_NOTICE, STUDENT_INPUT_NOTICE } from './studentInput.ts';

const transfer = (files = [], items = [], types = ['text/plain'], data = {}) =>
  ({ files, items, types, getData: (type) => data[type] || '' });

test('typed input remains text', () => {
  assert.deepEqual(createStudentMessageInput('  move load  ', 'text'), {
    content: 'move load', inputModality: 'text', transcriptionSource: undefined,
  });
  assert.equal(hasTransferredFiles(transfer()), false);
});

test('transcribed audio becomes text with modality metadata', () => {
  assert.deepEqual(createStudentMessageInput('Move the load', 'audio', 'recorded-audio'), {
    content: 'Move the load', inputModality: 'audio', transcriptionSource: 'recorded-audio',
  });
  assert.throws(() => createStudentMessageInput('raw audio', 'audio'));
});

test('image and document file transfers are rejected', () => {
  for (const type of ['image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/csv']) {
    assert.equal(hasTransferredFiles(transfer([{ type }], [], ['Files'])), true);
  }
});

test('drag and drop files are rejected', () => {
  assert.equal(hasTransferredFiles(transfer([], [{ kind: 'file', type: 'application/pdf' }], ['Files'])), true);
});

test('pasted images are identified while other files remain transfers', () => {
  assert.equal(hasTransferredFiles(transfer([], [{ kind: 'file', type: 'image/png' }], ['image/png'])), true);
  assert.equal(hasTransferredFiles(transfer([], [{ kind: 'file', type: 'application/pdf' }], ['Files'])), true);
  assert.equal(hasTransferredFiles(transfer([], [{ kind: 'string', type: 'text/plain' }], ['text/plain'])), false);
  assert.equal(hasTransferredFiles(transfer([], [], ['text/html'], { 'text/html': '<img src="data:image/png;base64,abc">' })), true);
  assert.equal(hasTransferredFiles(transfer([], [], ['text/uri-list'], { 'text/uri-list': 'https://example.test/figure.webp' })), true);
  assert.equal(hasTransferredFiles(transfer([], [], ['text/html', 'text/plain'], { 'text/html': '<b>plain words</b>', 'text/plain': 'plain words' })), false);
});

test('clipboard image extraction accepts images only', () => {
  const image = { name: 'diagram.png', type: 'image/png' };
  const document = { name: 'notes.pdf', type: 'application/pdf' };
  assert.deepEqual(pastedImageFiles(transfer([image, document])), [image]);
  assert.deepEqual(pastedImageFiles(transfer([], [{ kind: 'file', type: 'image/png', getAsFile: () => image }])), [image]);
  assert.deepEqual(pastedImageFiles(transfer([document])), []);
  assert.match(IMAGE_PASTE_NOTICE, /image/);
});

test('student composer has no file picker and handles image paste while guarding drop', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /<input\s+[^>]*type=["']file["']/i);
  assert.doesNotMatch(app, /<Paperclip\b|title=["']Attach files["']/i);
  assert.match(app, /onPaste=\{handleImagePaste\}/);
  assert.match(app, /aria-label="Pasted images"/);
  assert.match(app, /<Shuffle className="size-4" \/>/);
  assert.match(app, /<span>Different explanation<\/span>/);
  assert.match(app, /requestInFlightRef\.current/);
  assert.doesNotMatch(app, /<span>Ask another AI<\/span>/);
  assert.match(app, /onDropCapture=/);
  assert.match(app, /onDragOverCapture=/);
  assert.match(app, /STUDENT_INPUT_NOTICE/);
  assert.equal(STUDENT_INPUT_NOTICE, 'For this activity, please communicate by typing or using voice input.');
});
