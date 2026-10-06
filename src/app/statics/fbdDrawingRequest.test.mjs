import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFBDDrawingRequest, explicitlyRequestsFBDDrawing, isFBDDiagramPrompt } from './fbdDrawingRequest.ts';

test('recognizes explicit FBD drawing requests without treating advice as authorization', () => {
  assert.equal(explicitlyRequestsFBDDrawing('Draw the free-body diagram from this image.'), true);
  assert.equal(explicitlyRequestsFBDDrawing('Create an FBD for a cantilever beam.'), true);
  assert.equal(explicitlyRequestsFBDDrawing('What should I consider in this FBD?'), false);
  assert.equal(isFBDDiagramPrompt('Draw a free body diagram'), true);
});

test('drawing request requires cross-view supports and load roles', () => {
  const request = buildFBDDrawingRequest('Draw an FBD for member AD.');
  assert.match(request, /startJointKind and endJointKind/);
  assert.match(request, /role to applied or reaction/);
  assert.match(request, /attached image/);
  assert.match(request, /do not calculate unknown reaction magnitudes/i);
});
