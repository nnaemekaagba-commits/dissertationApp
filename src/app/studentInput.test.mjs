import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudentMessageInput, hasTransferredFiles } from './studentInput.ts';

const transfer = (files = [], items = [], types = ['text/plain']) => ({ files, items, types });

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

test('pasted image and file objects are rejected while pasted text is allowed', () => {
  assert.equal(hasTransferredFiles(transfer([], [{ kind: 'file', type: 'image/png' }], ['image/png'])), true);
  assert.equal(hasTransferredFiles(transfer([], [{ kind: 'file', type: 'application/pdf' }], ['Files'])), true);
  assert.equal(hasTransferredFiles(transfer([], [{ kind: 'string', type: 'text/plain' }], ['text/plain'])), false);
});
