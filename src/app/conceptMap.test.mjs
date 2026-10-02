import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildConceptMapRequest, parseConceptMap } from './conceptMap.ts';

test('valid concept map JSON is parsed and unsafe or malformed maps are rejected', () => {
  const map = parseConceptMap('```json\n{"title":"Beam","nodes":[{"id":"q","label":"What balances?","kind":"question"},{"id":"p","label":"Equilibrium","kind":"principle","prompt":"Which equation applies?"}],"edges":[{"from":"q","to":"p","label":"use"}]}\n```');
  assert.equal(map?.nodes.length, 2);
  assert.equal(map?.edges[0].label, 'use');
  assert.equal(parseConceptMap('{"nodes":[],"edges":[]}'), null);
  assert.equal(parseConceptMap('ordinary answer'), null);
});

test('chat exposes a visual concept-map action and blocks tool execution for it', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  const view = readFileSync(new URL('./components/ConceptMapView.tsx', import.meta.url), 'utf8');
  assert.match(app, /<span>Concept map<\/span>/);
  assert.match(app, /buildConceptMapRequest\(sourcePrompt, responseContent,/);
  assert.match(app, /if \(options\?\.conceptMapRequest\)[\s\S]*cannot invoke engineering or calculation tools/);
  assert.match(view, /The map does not change the FBD or run calculations/);
});

test('concept map request is grounded and explicitly forbids solving', () => {
  const prompt = buildConceptMapRequest('Is it balanced?', 'Review moments.', { supports: ['fixed'] }, { forces: [{ id: 'P' }] });
  assert.match(prompt, /Do not solve/);
  assert.match(prompt, /do not calculate numerical results/);
  assert.match(prompt, /fixed/);
  assert.match(prompt, /"id":"P"/);
  assert.match(prompt, /Return JSON only/);
});
