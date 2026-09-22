import type { FBDForce, FBDJoint, FBDPoint } from './fbdState';

const SAME_POINT_TOLERANCE = 1e-6;
const NON_PARALLEL_TOLERANCE = 1e-4;

function samePoint(left: FBDPoint, right: FBDPoint): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) <= SAME_POINT_TOLERANCE;
}

/**
 * Convert student-labelled reaction components into support symbols for the
 * translated Rigid Body View. A single reaction direction represents a roller;
 * two non-parallel reaction directions represent a pin. Explicitly authored
 * support metadata takes precedence at the same point.
 */
export function inferReactionSupports(forces: FBDForce[], occupiedPoints: FBDPoint[] = []): FBDJoint[] {
  const groups: FBDForce[][] = [];
  for (const force of forces.filter((item) => item.role === 'reaction')) {
    const existing = groups.find((group) => samePoint(group[0].at, force.at));
    if (existing) existing.push(force);
    else groups.push([force]);
  }

  return groups
    .filter((group) => !occupiedPoints.some((point) => samePoint(point, group[0].at)))
    .map((group, index) => {
      const directions = group.map((force) => {
        const radians = force.angle * Math.PI / 180;
        return { x: Math.cos(radians), y: Math.sin(radians) };
      });
      const hasIndependentDirections = directions.some((left, leftIndex) =>
        directions.slice(leftIndex + 1).some((right) =>
          Math.abs(left.x * right.y - left.y * right.x) > NON_PARALLEL_TOLERANCE));
      return {
        id: `reaction-support:${group.map((force) => force.id).sort().join('+') || index}`,
        at: { ...group[0].at },
        kind: hasIndependentDirections ? 'pin' as const : 'roller' as const,
      };
    });
}
