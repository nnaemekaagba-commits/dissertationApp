import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('student archive reads only the signed-in account event endpoint and has no replay writes', () => {
  const source = readFileSync(new URL('./StudentFBDArchive.tsx', import.meta.url), 'utf8');
  assert.match(source, /fetch\(`\$\{API_BASE_URL\}\/engineering-events`/);
  assert.match(source, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(source, /researcher\/fbd-events|studentIdInput|method:\s*['"]POST['"]|setFbdState|setWorkspace/);
  assert.match(source, /buildFBDReplay\(events, sessionId\)/);
  assert.match(source, /Previous/);
  assert.match(source, /Next/);
});

test('student Archive has an FBD tab without replacing the chat archive', () => {
  const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  assert.match(source, /My FBD History/);
  assert.match(source, /Chat Archive/);
  assert.match(source, /<StudentFBDArchive key=\{userId\} accessToken=\{accessToken\}/);
  assert.match(source, /archiveTab === 'fbd' \? <Suspense/);
});
