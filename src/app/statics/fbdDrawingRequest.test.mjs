import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildFBDDrawingRequest, explicitlyRequestsFBDDrawing, isFBDDiagramPrompt } from './fbdDrawingRequest.ts';

test('recognizes explicit FBD drawing requests without treating advice as authorization', () => {
  assert.equal(explicitlyRequestsFBDDrawing('Draw the free-body diagram from this image.'), true);
  assert.equal(explicitlyRequestsFBDDrawing('Create an FBD for a cantilever beam.'), true);
  assert.equal(explicitlyRequestsFBDDrawing('Recreate this FBD screenshot on the canvas.'), true);
  assert.equal(explicitlyRequestsFBDDrawing('Copy this sketch of a free body diagram.'), true);
  assert.equal(explicitlyRequestsFBDDrawing('Generate this on the canvas.', true), true);
  assert.equal(explicitlyRequestsFBDDrawing('Put the pasted image in the workspace.', true), true);
  assert.equal(explicitlyRequestsFBDDrawing('Generate this on the canvas.', false), false);
  assert.equal(explicitlyRequestsFBDDrawing('How should I draw this on the canvas?', true), false);
  assert.equal(explicitlyRequestsFBDDrawing('What should I consider in this FBD?'), false);
  assert.equal(isFBDDiagramPrompt('Draw a free body diagram'), true);
});

test('an attachment-aware request receives the drawing contract', () => {
  assert.match(buildFBDDrawingRequest('Recreate it on the canvas.', true), /FBD DRAWING CONTRACT/);
});

test('drawing request requires cross-view supports and load roles', () => {
  const request = buildFBDDrawingRequest('Draw an FBD for member AD.');
  assert.match(request, /startJointKind and endJointKind/);
  assert.match(request, /role to applied or reaction/);
  assert.match(request, /attached image/);
  assert.match(request, /interactive FBD canvas/);
  assert.match(request, /exactly one JSON object/);
  assert.match(request, /Do not return a prose-only explanation/);
  assert.match(request, /do not calculate unknown reaction magnitudes/i);
});

test('deployed OpenAI route requires an executable FBD canvas function call', () => {
  const server = readFileSync(new URL('../../../supabase/functions/make-server-09672449/index.ts', import.meta.url), 'utf8');
  assert.match(server, /name: "render_fbd_canvas"/);
  assert.match(server, /tool_choice: \{ type: "function", function: \{ name: "render_fbd_canvas" \} \}/);
  assert.match(server, /did not return the required FBD canvas action/);
});
