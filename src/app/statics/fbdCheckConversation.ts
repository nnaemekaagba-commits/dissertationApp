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
  const members = rows(state, 'members');
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
    return { key: pointKey(group.at),
      text: `${group.hasMoment ? 'fixed' : independent ? 'pin' : 'roller'} support at ${pointText(group.at)}` };
  });
  const explicit = [
    ...rows(state, 'joints').filter((item) => item.kind && item.kind !== 'free')
      .map((item) => ({ key: pointKey(item), text: `${item.kind} support at ${pointText(item)}` })),
    ...members.flatMap((member) => [
      member.startJointKind && member.startJointKind !== 'free'
        ? { key: pointKey({ at: member.start }),
          text: `${member.startJointKind} support at (${Number(member.start?.x)}, ${Number(member.start?.y)}) at the start of member ${member.label || member.id}` }
        : null,
      member.endJointKind && member.endJointKind !== 'free'
        ? { key: pointKey({ at: member.end }),
          text: `${member.endJointKind} support at (${Number(member.end?.x)}, ${Number(member.end?.y)}) at the end of member ${member.label || member.id}` }
        : null,
    ]).filter((item): item is { key: string; text: string } => item !== null),
  ];
  const supportsByPoint = new Map(inferred.map((item) => [item.key, item.text]));
  for (const item of explicit) supportsByPoint.set(item.key, item.text);
  const supports = [...supportsByPoint.values()];
  const forceList = forces.map((item) => `${item.role === 'reaction' ? 'reaction' : 'external'} force ${item.label || item.id}` +
    ` at ${pointText(item)}, angle ${Number(item.angle)}°, magnitude ${item.magnitude ?? 'unspecified'}`);
  const momentList = moments.map((item) => `${item.role === 'reaction' ? 'reaction' : 'external'} moment ${item.label || item.id}` +
    ` at ${pointText(item)}, ${item.clockwise ? 'clockwise' : 'counterclockwise'}, magnitude ${item.magnitude ?? 'unspecified'}`);
  const memberList = members.map((item) => String(item.label || item.id));
  return [`FBD View contains exactly ${members.length} member${members.length === 1 ? '' : 's'}: ${memberList.join(', ') || 'none'}.`,
    `FBD View forces: ${forceList.join('; ') || 'none'}.`, `FBD View moments: ${momentList.join('; ') || 'none'}.`,
    'FBD View distributed loads: none. The student FBD canvas has no distributed-load element.',
    `Rigid Body View contains exactly ${supports.length} support${supports.length === 1 ? '' : 's'}: ${supports.join('; ') || 'none explicitly or inferably defined'}.`,
    'Endpoint labels alone are not supports. Multiple reaction components at the same point belong to one support.'].join('\n');
}

export function buildFBDGroundedChatRequest(studentRequest: string, engineeringState: unknown,
  fbdState: unknown): string {
  const request = studentRequest.trim();
  if (!request) throw new Error('The student request is required.');
  const rigidBodySummary = describeRigidBodyCanvas(fbdState);
  const units = engineeringState && typeof engineeringState === 'object' && 'units' in engineeringState
    ? (engineeringState as { units?: unknown }).units : undefined;
  return `Answer the student's request using the current engineering canvas data below.
The FBD JSON is the student's actual visible work from ONE active member canvas. Hidden member canvases are deliberately excluded. Read BOTH the FBD View inventory and the Rigid Body View inventory before answering. The deterministic inventories below are exhaustive and authoritative. A support shown in Rigid Body View is present even when no support symbol is drawn in FBD View. Treat the Rigid Body View support count, types, and locations as authoritative. Use the exact member name listed there. Never mention a different member name. If the inventory says distributed loads are none, do not mention or infer a distributed load. Do not use engineering workspace geometry or loads to describe what is visible on this FBD canvas. Refer specifically only to actual members, forces, moments, labels, directions, magnitudes, and locations in the inventory and JSON. Do not treat an endpoint label as a support. Do not ask the student to repeat information already present. Do not invent canvas elements. Do not silently modify the diagram. If the request explicitly asks for a calculation, use an available deterministic calculation tool and place the validated result in chat; never substitute invented numerical results.

Student request:
${request}

Deterministic FBD View and Rigid Body View inventories:
${rigidBodySummary}

Current student-built FBD JSON:
${JSON.stringify(fbdState)}

Engineering units only (not canvas geometry or loads):
${JSON.stringify(units ?? null)}`;
}
