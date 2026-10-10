import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ATTACHMENT_ACCEPT, createStudentMessageInput, hasTransferredFiles, isSupportedAttachment,
  pastedImageFiles, transferredAttachmentFiles, IMAGE_PASTE_NOTICE, STUDENT_INPUT_NOTICE } from './studentInput.ts';

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

test('image and document file transfers are detected', () => {
  for (const type of ['image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/csv']) {
    assert.equal(hasTransferredFiles(transfer([{ type }], [], ['Files'])), true);
  }
});

test('drag and drop files are detected', () => {
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

test('upload extraction accepts supported images and documents', () => {
  const files = [
    { name: 'diagram.png', type: 'image/png' },
    { name: 'problem.pdf', type: 'application/pdf' },
    { name: 'notes.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { name: 'loads.csv', type: 'text/csv' },
    { name: 'program.exe', type: 'application/octet-stream' },
  ];
  assert.deepEqual(transferredAttachmentFiles(transfer(files)), files.slice(0, 4));
  assert.equal(isSupportedAttachment({ name: 'problem.md', type: '' }), true);
  assert.equal(isSupportedAttachment(files[4]), false);
  assert.match(ATTACHMENT_ACCEPT, /\.pdf/);
});

test('student composer uploads documents and images through picker, paste, and drop', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  assert.match(app, /type="file" multiple accept=\{ATTACHMENT_ACCEPT\}/);
  assert.match(app, /<Paperclip\b/);
  assert.match(app, /onPaste=\{handleAttachmentPaste\}/);
  assert.match(app, /aria-label="Attached files"/);
  assert.match(app, /transferredAttachmentFiles\(e\.dataTransfer\)/);
  assert.match(app, /<Shuffle className="size-4" \/>/);
  assert.match(app, /<span>Different explanation<\/span>/);
  assert.match(app, /requestInFlightRef\.current/);
  assert.doesNotMatch(app, /<span>Ask another AI<\/span>/);
  assert.doesNotMatch(app, /onDropCapture=/);
  assert.match(STUDENT_INPUT_NOTICE, /Upload an image/);
});
