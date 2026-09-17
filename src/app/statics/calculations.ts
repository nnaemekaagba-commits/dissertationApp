import { parseStaticsWorkspace, type ForceUnit, type LengthUnit, type StaticsNode, type StaticsWorkspace } from './model.ts';

export interface BeamReaction {
  supportId: string;
  nodeId: string;
  kind: 'pin' | 'roller' | 'fixed';
  /** Signed components: +x right, +y up, positive moment counterclockwise. */
  horizontal: number;
  vertical: number;
  moment: number;
}

export interface BeamReactionResult {
  forceUnit: ForceUnit;
  lengthUnit: LengthUnit;
  /** Reaction moments use forceUnit × lengthUnit, regardless of input moment unit. */
  momentUnit: string;
  reactions: BeamReaction[];
  equilibrium: {
    horizontalResidual: number;
    verticalResidual: number;
    momentResidualAboutLeft: number;
  };
}

type Vector3 = [number, number, number];
interface Unknown {
  supportId: string;
  component: 'horizontal' | 'vertical' | 'moment' | 'roller';
  column: Vector3;
  direction?: { x: number; y: number };
}

const EPSILON = 1e-10;
const clean = (value: number) => Math.abs(value) < EPSILON ? 0 : value;
const FORCE_TO_N: Record<ForceUnit, number> = { N: 1, kN: 1000, lbf: 4.4482216152605, kip: 4448.2216152605 };
const LENGTH_TO_M: Record<LengthUnit, number> = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };
const MOMENT_TO_NM = { 'N*m': 1, 'kN*m': 1000, 'lbf*ft': FORCE_TO_N.lbf * LENGTH_TO_M.ft,
  'kip*ft': FORCE_TO_N.kip * LENGTH_TO_M.ft };

function solveThreeByThree(columns: Vector3[], rightHandSide: Vector3): Vector3 {
  const rows = rightHandSide.map((rhs, row) => [...columns.map((column) => column[row]), rhs]);
  for (let pivot = 0; pivot < 3; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < 3; row++) {
      if (Math.abs(rows[row][pivot]) > Math.abs(rows[best][pivot])) best = row;
    }
    const columnScale = Math.max(1, ...rows.slice(pivot).map((row) => Math.abs(row[pivot])));
    if (Math.abs(rows[best][pivot]) <= EPSILON * columnScale) {
      throw new Error('The support arrangement is unstable or cannot be solved by planar equilibrium.');
    }
    [rows[pivot], rows[best]] = [rows[best], rows[pivot]];
    const divisor = rows[pivot][pivot];
    for (let column = pivot; column < 4; column++) rows[pivot][column] /= divisor;
    for (let row = 0; row < 3; row++) {
      if (row === pivot) continue;
      const factor = rows[row][pivot];
      for (let column = pivot; column < 4; column++) rows[row][column] -= factor * rows[pivot][column];
    }
  }
  return [rows[0][3], rows[1][3], rows[2][3]];
}

/** Solve ΣFx = 0, ΣFy = 0, and ΣM(left) = 0 for a horizontal planar beam. */
export function calculatePlanarBeamReactions(input: StaticsWorkspace): BeamReactionResult {
  const workspace = parseStaticsWorkspace(input);
  if (workspace.members.length !== 1) throw new Error('Expected one beam member.');
  const member = workspace.members[0];
  const nodes = new Map(workspace.nodes.map((node) => [node.id, node]));
  const start = nodes.get(member.startNodeId)!;
  const end = nodes.get(member.endNodeId)!;
  if (Math.abs(start.y - end.y) > EPSILON || Math.abs(start.x - end.x) <= EPSILON) {
    throw new Error('Only horizontal beams with nonzero length are supported.');
  }
  const [left, right] = start.x < end.x ? [start, end] : [end, start];
  const beamLength = right.x - left.x;
  const onBeam = (node: StaticsNode, description: string) => {
    if (Math.abs(node.y - left.y) > EPSILON || node.x < left.x - EPSILON || node.x > right.x + EPSILON) {
      throw new Error(`${description} must be located on the beam.`);
    }
  };
  const radians = (angle: number) => workspace.units.angle === 'rad' ? angle : angle * Math.PI / 180;
  const momentFrom = (x: number, y: number, fx: number, fy: number) =>
    (x - left.x) * fy - (y - left.y) * fx;

  const unknowns: Unknown[] = [];
  for (const support of workspace.supports) {
    const point = nodes.get(support.nodeId)!;
    onBeam(point, `Support ${support.id}`);
    if (support.kind === 'roller') {
      const angle = support.reactionAngle ?? (workspace.units.angle === 'rad' ? Math.PI / 2 : 90);
      const x = clean(Math.cos(radians(angle)));
      const y = clean(Math.sin(radians(angle)));
      unknowns.push({ supportId: support.id, component: 'roller',
        column: [x, y, momentFrom(point.x, point.y, x, y)], direction: { x, y } });
    } else {
      unknowns.push({ supportId: support.id, component: 'horizontal', column: [1, 0, momentFrom(point.x, point.y, 1, 0)] });
      unknowns.push({ supportId: support.id, component: 'vertical', column: [0, 1, momentFrom(point.x, point.y, 0, 1)] });
      if (support.kind === 'fixed') {
        unknowns.push({ supportId: support.id, component: 'moment', column: [0, 0, 1] });
      }
    }
  }
  if (unknowns.length !== 3) {
    throw new Error('The supports must provide exactly three independent reaction components; other arrangements are statically indeterminate or unstable.');
  }

  let appliedHorizontal = 0;
  let appliedVertical = 0;
  let appliedMomentAboutLeft = 0;
  for (const load of workspace.loads) {
    if (load.kind === 'moment') {
      const point = nodes.get(load.nodeId)!;
      onBeam(point, `Moment ${load.id}`);
      const momentScale = workspace.units.moment
        ? MOMENT_TO_NM[workspace.units.moment] / (FORCE_TO_N[workspace.units.force] * LENGTH_TO_M[workspace.units.length])
        : 1;
      appliedMomentAboutLeft += load.magnitude * momentScale;
      continue;
    }
    const angle = radians(load.angle);
    const directionX = clean(Math.cos(angle));
    const directionY = clean(Math.sin(angle));
    if (load.kind === 'force') {
      const point = nodes.get(load.nodeId)!;
      onBeam(point, `Load ${load.id}`);
      const fx = load.magnitude * directionX;
      const fy = load.magnitude * directionY;
      appliedHorizontal += fx;
      appliedVertical += fy;
      appliedMomentAboutLeft += momentFrom(point.x, point.y, fx, fy);
    } else {
      // The linearly varying intensity is defined from the member's start to end.
      const total = beamLength * (load.startMagnitude + load.endMagnitude) / 2;
      const firstMomentFromStart = beamLength * beamLength *
        (load.startMagnitude + 2 * load.endMagnitude) / 6;
      const signedDirection = Math.sign(end.x - start.x);
      const weightedXFromLeft = (start.x - left.x) * total + signedDirection * firstMomentFromStart;
      appliedHorizontal += total * directionX;
      appliedVertical += total * directionY;
      appliedMomentAboutLeft += weightedXFromLeft * directionY;
    }
  }

  const solution = solveThreeByThree(unknowns.map((unknown) => unknown.column),
    [-appliedHorizontal, -appliedVertical, -appliedMomentAboutLeft]);
  const reactions: BeamReaction[] = workspace.supports.map((support) => ({
    supportId: support.id, nodeId: support.nodeId, kind: support.kind,
    horizontal: 0, vertical: 0, moment: 0,
  }));
  unknowns.forEach((unknown, index) => {
    const reaction = reactions.find((item) => item.supportId === unknown.supportId)!;
    const value = solution[index];
    if (unknown.component === 'roller') {
      reaction.horizontal += value * unknown.direction!.x;
      reaction.vertical += value * unknown.direction!.y;
    } else reaction[unknown.component] += value;
  });
  reactions.forEach((reaction) => {
    reaction.horizontal = clean(reaction.horizontal);
    reaction.vertical = clean(reaction.vertical);
    reaction.moment = clean(reaction.moment);
  });
  reactions.sort((a, b) => nodes.get(a.nodeId)!.x - nodes.get(b.nodeId)!.x);
  const reactionHorizontal = reactions.reduce((sum, reaction) => sum + reaction.horizontal, 0);
  const reactionVertical = reactions.reduce((sum, reaction) => sum + reaction.vertical, 0);
  const reactionMoment = reactions.reduce((sum, reaction) => {
    const point = nodes.get(reaction.nodeId)!;
    return sum + momentFrom(point.x, point.y, reaction.horizontal, reaction.vertical) + reaction.moment;
  }, 0);
  return {
    forceUnit: workspace.units.force,
    lengthUnit: workspace.units.length,
    momentUnit: `${workspace.units.force}*${workspace.units.length}`,
    reactions,
    equilibrium: {
      horizontalResidual: clean(appliedHorizontal + reactionHorizontal),
      verticalResidual: clean(appliedVertical + reactionVertical),
      momentResidualAboutLeft: clean(appliedMomentAboutLeft + reactionMoment),
    },
  };
}

/** Compatibility alias for existing callers. */
export const calculateSimplySupportedBeamReactions = calculatePlanarBeamReactions;
