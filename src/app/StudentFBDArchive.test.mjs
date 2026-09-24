import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadLocalResearchEvents, saveLocalResearchEvent } from './statics/researchLog.ts';

test('student archive merges account events with durable local fallback and has no replay writes', () => {
  const source = readFileSync(new URL('./StudentFBDArchive.tsx', import.meta.url), 'utf8');
  assert.match(source, /fetch\(`\$\{API_BASE_URL\}\/engineering-events`/);
  assert.match(source, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(source, /loadLocalResearchEvents\(localStorage, userId\)/);
  assert.doesNotMatch(source, /researcher\/fbd-events|studentIdInput|method:\s*['"]POST['"]|setFbdState|setWorkspace/);
  assert.match(source, /buildFBDReplay\(events, sessionId\)/);
  assert.match(source, /Previous/);
  assert.match(source, /Next/);
});

test('student Archive has an FBD tab without replacing the chat archive', () => {
  const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  assert.match(source, /My FBD History/);
  assert.match(source, /Chat Archive/);
  assert.match(source, /<StudentFBDArchive key=\{userId \|\| 'guest'\} accessToken=\{accessToken\} userId=\{researchActorId\}/);
  assert.match(source, /archiveTab === 'fbd' \? <Suspense/);
});

test('FBD research events persist chronologically per account and for guest sessions', () => {
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value) };
  const later = { kind: 'visualization', eventId: 'later', sessionId: 's', timestamp: '2026-09-24T02:00:00.000Z', action: 'fbd_force_add' };
  const earlier = { kind: 'visualization', eventId: 'earlier', sessionId: 's', timestamp: '2026-09-24T01:00:00.000Z', action: 'fbd_enter' };
  saveLocalResearchEvent(storage, 'student-1', later);
  saveLocalResearchEvent(storage, 'student-1', earlier);
  saveLocalResearchEvent(storage, 'guest', { ...earlier, eventId: 'guest-event' });
  assert.deepEqual(loadLocalResearchEvents(storage, 'student-1').map((event) => event.eventId), ['earlier', 'later']);
  assert.deepEqual(loadLocalResearchEvents(storage, 'guest').map((event) => event.eventId), ['guest-event']);
});
