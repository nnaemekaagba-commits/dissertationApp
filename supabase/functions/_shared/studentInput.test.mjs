import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { studentAttachmentError } from './studentInput.ts';

test('Supabase student routes accept typed and transcribed audio text', () => {
  assert.equal(studentAttachmentError({ message: 'Move load', files: [] }, true), null);
  assert.equal(studentAttachmentError({ content: 'Transcribed voice', inputModality: 'audio' }), null);
});

test('Supabase student routes reject uploaded images, documents, and references', () => {
  for (const field of ['files', 'attachments', 'imageUrl', 'documentId', 'fileUrl', 'uploads']) {
    assert.match(studentAttachmentError({ message: 'hello', [field]: [{ name: 'paper.pdf' }] }, true) || '', /attachments/);
  }
  assert.match(studentAttachmentError({ message: 'hello', conversationHistory: [{ content: 'old', attachments: [{ name: 'photo.png' }] }] }, true) || '', /attachments/);
  assert.match(studentAttachmentError({ message: '<img src="https://example.test/a.png">' }) || '', /attachments/);
  assert.match(studentAttachmentError({ role: 'assistant', content: 'generated', attachments: [{ generated: true }] }, false, false) || '', /attachments/);
  assert.equal(studentAttachmentError({ role: 'assistant', content: '![generated](data:image/png;base64,AAAA)' }, false, false), null);
});

test('both Supabase chat and message routes call attachment validation', () => {
  for (const relativePath of ['../server/index.tsx', '../make-server-09672449/index.ts']) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /studentAttachmentError\(body, true\)/);
    assert.match(source, /studentAttachmentError\(body, false, role === "user"\)/);
  }
});
