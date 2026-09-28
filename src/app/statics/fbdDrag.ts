import type { FBDPoint } from './fbdState.ts';

type Position2D = { x: number; y: number };

/** Convert a scene-object drag into the force's absolute engineering coordinates. */
export function pointAfterSceneDrag(
  originalPoint: FBDPoint,
  originalObjectPosition: Position2D,
  currentObjectPosition: Position2D,
): FBDPoint {
  return {
    x: originalPoint.x + currentObjectPosition.x - originalObjectPosition.x,
    y: originalPoint.y + currentObjectPosition.y - originalObjectPosition.y,
  };
}

export const forceApplicationPointAfterDrag = pointAfterSceneDrag;
