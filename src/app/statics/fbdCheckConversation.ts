export const FBD_CHECK_QUESTIONS = `Before I help review your FBD, please answer these questions:

1. What questions do you have about your FBD?
2. Can you describe the statics problem you are trying to solve?

I will use your answers together with the current diagram to give you targeted hints. I will not change your FBD or run calculations.`;

export function buildFBDCoachingRequest(studentResponse: string): string {
  const response = studentResponse.trim();
  if (!response) throw new Error('The FBD coaching response is required.');
  return `What follows is a request for coaching about the current student-built free-body diagram.
Use the supplied FBD JSON and the student's problem description below. Apply engineering statics knowledge and give targeted hints that refer to the actual bodies, forces, moments, labels, directions, and locations present in the FBD. Explain what the student should think about next. Ask one concise follow-up question if essential information is missing.

Do not modify the FBD and do not call mutating engineering or FBD tools. If the student's response explicitly requests a calculation, use the appropriate deterministic calculation tool and report its validated result in chat. Do not invent numerical results or substitute a language-model calculation for a tool result. Do not display calculation results in the visualization unless the student explicitly requests visual display. Do not claim an element is missing unless the student's problem description supports that conclusion.

Student's FBD question and problem description:
${response}`;
}

type CanvasRow = Record<string, any>;
const rows = (state: CanvasRow, key: string): CanvasRow[] => Array.isArray(state[key]) ? state[key] : [];
const pointKey = (row: CanvasRow): string => `${Number(row.at?.x).toFixed(6)},${Number(row.at?.y).toFixed(6)}`;
const pointText = (row: CanvasRow): string => `(${Number(row.at?.x)}, ${Number(row.at?.y)})`;

export function describeRigidBodyCanvas(fbdState: unknown): string {
  const state = fbdState && typeof fbdState === 'object' ? fbdState as CanvasRow : {};
  const forces = rows(state, 'forces');
  const moments = rows(state, 'moments');
  const reactionForces = forces.filter((item) => item.role === 'reaction');
  const reactionMoments = moments.filter((item) => item.role === 'reaction');
  const supportPoints = new Map<string, { at: CanvasRow; forceAngles: number[]; hasMoment: boolean }>();
  for (const force of reactionForces) {
    const key = pointKey(force);
    const group = supportPoints.get(key) ?? { at: force, forceAngles: [], hasMoment: false };
    group.forceAngles.push(Number(force.angle));
    supportPoints.set(key, group);
  }
  for (const moment of reactionMoments) {
    const key = pointKey(moment);
    const group = supportPoints.get(key) ?? { at: moment, forceAngles: [], hasMoment: false };
    group.hasMoment = true;
    supportPoints.set(key, group);
  }
  const inferred = [...supportPoints.values()].map((group) => {
    const directions = group.forceAngles.map((angle) => angle * Math.PI / 180);
    const independent = directions.some((left, index) => directions.slice(index + 1)
      .some((right) => Math.abs(Math.sin(left - right)) > 1e-4));
    return `${group.hasMoment ? 'fixed' : independent ? 'pin' : 'roller'} support at ${pointText(group.at)}`;
  });
  const explicit = [
    ...rows(state, 'joints').filter((item) => item.kind && item.kind !== 'free')
      .map((item) => `${item.kind} support at ${pointText(item)}`),
  ];
  const supports = [...new Set([...explicit, ...inferred])];
  const forceList = forces.map((item) => `${item.role === 'reaction' ? 'reaction' : 'external'} force ${item.label || item.id}` +
    ` at ${pointText(item)}, angle ${Number(item.angle)}°, magnitude ${item.magnitude ?? 'unspecified'}`);
  const momentList = moments.map((item) => `${item.role === 'reaction' ? 'reaction' : 'external'} moment ${item.label || item.id}` +
    ` at ${pointText(item)}, ${item.clockwise ? 'clockwise' : 'counterclockwise'}, magnitude ${item.magnitude ?? 'unspecified'}`);
  return [`Rigid Body View contains exactly ${supports.length} support${supports.length === 1 ? '' : 's'}: ${supports.join('; ') || 'none explicitly or inferably defined'}.`,
    `Forces: ${forceList.join('; ') || 'none'}.`, `Moments: ${momentList.join('; ') || 'none'}.`,
    'Endpoint labels alone are not supports. Multiple reaction components at the same point belong to one support.'].join('\n');
}

export function buildFBDGroundedChatRequest(studentRequest: string, engineeringState: unknown,
  fbdState: unknown): string {
  const request = studentRequest.trim();
  if (!request) throw new Error('The student request is required.');
  const rigidBodySummary = describeRigidBodyCanvas(fbdState);
  return `Answer the student's request using the current engineering canvas data below.
The FBD JSON is the student's actual visible work. Review both the FBD and the deterministic Rigid Body View summary before answering. Treat the summary's support count and classifications as authoritative. Refer specifically to actual bodies, members, forces, moments, labels, directions, magnitudes, and locations. Do not treat an endpoint label as a support. Do not ask the student to repeat information already present in these snapshots. Do not invent canvas elements. Do not silently modify the diagram. If the request explicitly asks for a calculation, use an available deterministic calculation tool and place the validated result in chat; never substitute invented numerical results.

Student request:
${request}

Deterministic Rigid Body View summary:
${rigidBodySummary}

Current student-built FBD JSON:
${JSON.stringify(fbdState)}

Current engineering workspace JSON:
${JSON.stringify(engineeringState)}`;
}
