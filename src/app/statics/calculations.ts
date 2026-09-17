import { parseStaticsWorkspace, type ForceUnit, type LengthUnit, type StaticsSupport, type StaticsWorkspace } from './model.ts';

export interface BeamReaction {
  supportId: string;
  nodeId: string;
  kind: 'pin' | 'roller';
  /** Signed components; positive x is right and positive y is up. */
  horizontal: number;
  vertical: number;
}

export interface BeamReactionResult {
  forceUnit: ForceUnit;
  lengthUnit: LengthUnit;
  reactions: BeamReaction[];
  equilibrium: {
    horizontalResidual: number;
    verticalResidual: number;
    momentResidualAboutLeft: number;
  };
}

const EPSILON = 1e-10;
const clean = (value: number) => Math.abs(value) < EPSILON ? 0 : value;

/** Solve ΣFy = 0 and ΣM(left) = 0 for one horizontal beam with a pin and a vertical roller. */
export function calculateSimplySupportedBeamReactions(input: StaticsWorkspace): BeamReactionResult {
  const workspace = parseStaticsWorkspace(input);
  if (workspace.members.length !== 1) throw new Error('Expected one beam member.');
  const member = workspace.members[0];
  const start = workspace.nodes.find((node) => node.id === member.startNodeId)!;
  const end = workspace.nodes.find((node) => node.id === member.endNodeId)!;
  if (Math.abs(start.y - end.y) > EPSILON || Math.abs(start.x - end.x) <= EPSILON) {
    throw new Error('Only horizontal beams with nonzero length are supported.');
  }
  const [left, right] = start.x < end.x ? [start, end] : [end, start];
  const length = right.x - left.x;
  if (workspace.supports.length !== 2 ||
    workspace.supports.filter((support) => support.kind === 'pin').length !== 1 ||
    workspace.supports.filter((support) => support.kind === 'roller').length !== 1) {
    throw new Error('Expected exactly one pin and one roller support.');
  }
  const leftSupport = workspace.supports.find((support) => support.nodeId === left.id);
  const rightSupport = workspace.supports.find((support) => support.nodeId === right.id);
  if (!leftSupport || !rightSupport) throw new Error('Supports must be at the beam endpoints.');
  const roller = workspace.supports.find((support): support is StaticsSupport & { kind: 'roller' } => support.kind === 'roller')!;
  const rollerAngle = roller.reactionAngle ?? (workspace.units.angle === 'rad' ? Math.PI / 2 : 90);
  const rollerRadians = workspace.units.angle === 'rad' ? rollerAngle : rollerAngle * Math.PI / 180;
  if (Math.abs(Math.cos(rollerRadians)) > EPSILON) {
    throw new Error('Only rollers with vertical reactions are supported.');
  }

  let appliedVertical = 0;
  let appliedMomentAboutLeft = 0;
  for (const load of workspace.loads) {
    if (load.kind !== 'force') throw new Error('Only vertical point loads are supported.');
    const point = workspace.nodes.find((node) => node.id === load.nodeId)!;
    if (Math.abs(point.y - left.y) > EPSILON || point.x < left.x - EPSILON || point.x > right.x + EPSILON) {
      throw new Error(`Load ${load.id} must be located on the beam.`);
    }
    const radians = workspace.units.angle === 'rad' ? load.angle : load.angle * Math.PI / 180;
    if (Math.abs(Math.cos(radians)) > EPSILON) {
      throw new Error(`Load ${load.id} is not vertical.`);
    }
    const vertical = load.magnitude * Math.sin(radians);
    appliedVertical += vertical;
    appliedMomentAboutLeft += vertical * (point.x - left.x);
  }

  const rightVertical = -appliedMomentAboutLeft / length;
  const leftVertical = -appliedVertical - rightVertical;
  const reactions: BeamReaction[] = [
    { supportId: leftSupport.id, nodeId: left.id, kind: leftSupport.kind as 'pin' | 'roller',
      horizontal: 0, vertical: clean(leftVertical) },
    { supportId: rightSupport.id, nodeId: right.id, kind: rightSupport.kind as 'pin' | 'roller',
      horizontal: 0, vertical: clean(rightVertical) },
  ];
  return {
    forceUnit: workspace.units.force,
    lengthUnit: workspace.units.length,
    reactions,
    equilibrium: {
      horizontalResidual: 0,
      verticalResidual: clean(leftVertical + rightVertical + appliedVertical),
      momentResidualAboutLeft: clean(rightVertical * length + appliedMomentAboutLeft),
    },
  };
}
