import { createSimplySupportedBeamWorkspace, type StaticsWorkspace } from './model.ts';
import { addFBDForce, addFBDMoment, createEmptyFBDState, selectFBDTarget,
  type FBDForceInput, type FBDMomentInput, type FBDState, type FBDTarget } from './fbdState.ts';
import type { FBDCheckIssueKind } from './checkFBD.ts';

type ForceSpec = { id: string } & FBDForceInput;
type MomentSpec = { id: string } & FBDMomentInput;
export type FBDDevelopmentCase = {
  id: string;
  description: string;
  engineeringState: StaticsWorkspace;
  target: FBDTarget;
  /** Student-created marks expected on a valid conceptual diagram; magnitudes are only given values. */
  expected: FBDState;
  commonIncorrect: { description: string; state: FBDState; expectedIssues: FBDCheckIssueKind[] }[];
  /** Current checker cannot infer truss member-end forces from connectivity alone. */
  checkerLimit?: string;
};

const at = (x: number, y = 0) => ({ x, y });
const force = (id: string, x: number, y: number, angle: number, label: string,
  magnitude?: number): ForceSpec => ({ id, at: at(x, y), angle, label,
    ...(magnitude === undefined ? {} : { magnitude }) });
const moment = (id: string, x: number, y: number, clockwise: boolean, label: string,
  magnitude?: number): MomentSpec => ({ id, at: at(x, y), clockwise, label,
    ...(magnitude === undefined ? {} : { magnitude }) });
function diagram(engineeringState: StaticsWorkspace, target: FBDTarget,
  forces: ForceSpec[], moments: MomentSpec[] = []): FBDState {
  let state = selectFBDTarget(createEmptyFBDState(engineeringState), target, engineeringState);
  for (const { id, ...input } of forces) state = addFBDForce(state, input, engineeringState, id);
  for (const { id, ...input } of moments) state = addFBDMoment(state, input, engineeringState, id);
  return state;
}
const body: FBDTarget = { kind: 'body', id: 'structure' };
const beam = createSimplySupportedBeamWorkspace();
const beamForces = [force('P', 2, 0, -90, 'P', 10), force('Ax', 0, 0, 0, 'A_x'),
  force('Ay', 0, 0, 90, 'A_y'), force('By', 4, 0, 90, 'B_y')];
const cantilever: StaticsWorkspace = {
  ...beam, supports: [{ id: 'fixed-A', nodeId: 'A', kind: 'fixed' }],
};
const inclined: StaticsWorkspace = {
  ...beam, loads: [{ id: 'inclined-C', kind: 'force', nodeId: 'C', magnitude: 8, angle: -30 }],
};
const couple: StaticsWorkspace = {
  ...beam, loads: [{ id: 'couple-C', kind: 'moment', nodeId: 'C', magnitude: 6 }],
};
const truss: StaticsWorkspace = {
  nodes: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 2, y: 0 }, { id: 'C', x: 1, y: 2 }],
  members: [{ id: 'AC', startNodeId: 'A', endNodeId: 'C' },
    { id: 'BC', startNodeId: 'B', endNodeId: 'C' }],
  supports: [{ id: 'pin-A', nodeId: 'A', kind: 'pin' },
    { id: 'roller-B', nodeId: 'B', kind: 'roller', reactionAngle: 90 }],
  loads: [{ id: 'P-C', kind: 'force', nodeId: 'C', magnitude: 5, angle: -90 }],
  dimensions: [], units: { length: 'm', force: 'kN' },
};
const multiple: StaticsWorkspace = {
  nodes: [{ id: 'A', x: 0, y: 0 }, { id: 'C', x: 1, y: 0 },
    { id: 'D', x: 3, y: 0 }, { id: 'B', x: 4, y: 0 }],
  members: [{ id: 'AB', startNodeId: 'A', endNodeId: 'B' }],
  supports: beam.supports, dimensions: beam.dimensions.filter((item) => item.id === 'A-B'),
  loads: [{ id: 'P-C', kind: 'force', nodeId: 'C', magnitude: 4, angle: -90 },
    { id: 'Q-D', kind: 'force', nodeId: 'D', magnitude: 7, angle: -90 }],
  units: { length: 'm', force: 'kN' },
};

/** Development-only examples. They are never loaded into a student's workspace. */
export const FBD_DEVELOPMENT_CASES: FBDDevelopmentCase[] = [
  {
    id: 'simply-supported-beam', description: 'Pin at A, roller at B, 10 kN downward at C.',
    engineeringState: beam, target: body, expected: diagram(beam, body, beamForces),
    commonIncorrect: [{ description: 'Omitted given point load',
      state: diagram(beam, body, beamForces.slice(1)), expectedIssues: ['omitted_applied_load'] },
    { description: 'Roller reaction drawn horizontally',
      state: diagram(beam, body, [...beamForces.slice(0, 3), force('Bx', 4, 0, 0, 'B_x')]),
      expectedIssues: ['incorrect_support_reaction'] }],
  },
  {
    id: 'cantilever-beam', description: 'Fixed support at A, downward point load at C.',
    engineeringState: cantilever, target: body,
    expected: diagram(cantilever, body, [force('P', 2, 0, -90, 'P', 10),
      force('Ax', 0, 0, 0, 'A_x'), force('Ay', 0, 0, 90, 'A_y')],
    [moment('MA', 0, 0, false, 'M_A')]),
    commonIncorrect: [{ description: 'Fixed-support reaction moment omitted',
      state: diagram(cantilever, body, [force('P', 2, 0, -90, 'P', 10),
        force('Ax', 0, 0, 0, 'A_x'), force('Ay', 0, 0, 90, 'A_y')]),
      expectedIssues: ['missing_moment'] }],
  },
  {
    id: 'inclined-force', description: '8 kN load at 30 degrees below +x on a supported beam.',
    engineeringState: inclined, target: body,
    expected: diagram(inclined, body, [force('P', 2, 0, -30, 'P', 8), ...beamForces.slice(1)]),
    commonIncorrect: [{ description: 'Inclined load drawn vertically',
      state: diagram(inclined, body, [force('P', 2, 0, -90, 'P', 8), ...beamForces.slice(1)]),
      expectedIssues: ['incorrect_force_direction'] }],
  },
  {
    id: 'applied-couple', description: 'Counterclockwise applied couple at C.',
    engineeringState: couple, target: body,
    expected: diagram(couple, body, beamForces.slice(1), [moment('MC', 2, 0, false, 'M', 6)]),
    commonIncorrect: [{ description: 'Applied couple drawn clockwise',
      state: diagram(couple, body, beamForces.slice(1), [moment('MC', 2, 0, true, 'M', 6)]),
      expectedIssues: ['incorrect_moment_direction'] }],
  },
  {
    id: 'pin-jointed-truss-joint', description: 'Isolate joint C and show its two member interaction forces.',
    engineeringState: truss, target: { kind: 'joint', id: 'C' },
    expected: diagram(truss, { kind: 'joint', id: 'C' }, [force('P', 1, 2, -90, 'P', 5),
      force('FAC', 1, 2, -116.565, 'F_AC'), force('FBC', 1, 2, -63.435, 'F_BC')]),
    commonIncorrect: [{ description: 'Given load omitted at isolated joint',
      state: diagram(truss, { kind: 'joint', id: 'C' }, []),
      expectedIssues: ['omitted_applied_load'] }],
    checkerLimit: 'member-end interaction forces',
  },
  {
    id: 'member-isolation', description: 'Isolate beam member AB with its load and end reactions.',
    engineeringState: beam, target: { kind: 'member', id: 'AB' },
    expected: diagram(beam, { kind: 'member', id: 'AB' }, beamForces),
    commonIncorrect: [{ description: 'Given member load omitted',
      state: diagram(beam, { kind: 'member', id: 'AB' }, beamForces.slice(1)),
      expectedIssues: ['omitted_applied_load'] }],
  },
  {
    id: 'multiple-applied-loads', description: 'Two downward point loads at different beam positions.',
    engineeringState: multiple, target: body,
    expected: diagram(multiple, body, [force('P', 1, 0, -90, 'P', 4),
      force('Q', 3, 0, -90, 'Q', 7), ...beamForces.slice(1)]),
    commonIncorrect: [{ description: 'Second applied load omitted',
      state: diagram(multiple, body, [force('P', 1, 0, -90, 'P', 4), ...beamForces.slice(1)]),
      expectedIssues: ['omitted_applied_load'] },
    { description: 'Extra invented point load',
      state: diagram(multiple, body, [force('P', 1, 0, -90, 'P', 4),
        force('Q', 3, 0, -90, 'Q', 7), ...beamForces.slice(1), force('R', 2, 0, -90, 'R')]),
      expectedIssues: ['extra_force'] }],
  },
];
