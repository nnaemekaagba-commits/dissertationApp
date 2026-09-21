import type { StaticsWorkspace } from './model.ts';
import { engineeringStructureKey, type FBDForce, type FBDMoment, type FBDPoint, type FBDState } from './fbdState.ts';
import { DEFAULT_GIVEN_VISIBILITY, selectGivenFBDInformation } from './fbdGiven.ts';

export type FBDCheckIssueKind = 'missing_force' | 'extra_force' | 'incorrect_force_direction' |
  'missing_moment' | 'extra_moment' | 'incorrect_moment_direction' |
  'incorrect_support_reaction' | 'omitted_applied_load' | 'incorrect_given_magnitude' |
  'select_target' | 'stale_structure' | 'diagram_context_mismatch';
export type FBDCheckIssue = { kind: FBDCheckIssueKind; description: string; elementId?: string; sourceId?: string };
export type FBDCheckResult = {
  status: 'no_discrepancies' | 'needs_revision' | 'limited';
  selectedTarget: FBDState['selectedTarget'];
  issues: FBDCheckIssue[];
  limitations: string[];
  checked: { appliedForces: number; appliedMoments: number; supportForceComponents: number; supportMoments: number };
};

const degrees = (angle: number, units: StaticsWorkspace['units']) => units.angle === 'rad' ? angle * 180 / Math.PI : angle;
const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const axisGap = (a: number, b: number) => Math.min(angleGap(a, b), angleGap(a, b + 180));
const distance = (a: FBDPoint, b: FBDPoint) => Math.hypot(a.x - b.x, a.y - b.y);

const diagramBaseNames = (state: FBDState) => [...state.bodies, ...state.members, ...state.joints]
  .map((item) => (item.label || item.id).trim()).filter(Boolean);

/** Stops a scratch-built diagram from being assessed against an unrelated problem object. */
function diagramContextMismatch(workspace: StaticsWorkspace, state: FBDState): string | null {
  const names = diagramBaseNames(state);
  if (!names.length || !state.selectedTarget) return null;
  const target = state.selectedTarget;
  if (target.kind === 'member') {
    const member = workspace.members.find((item) => item.id === target.id);
    if (!member) return `The selected problem member ${target.id} is no longer available.`;
    const accepted = new Set([
      member.id.toLowerCase(),
      `${member.startNodeId}${member.endNodeId}`.toLowerCase(),
      `${member.endNodeId}${member.startNodeId}`.toLowerCase(),
    ]);
    if (!names.some((name) => accepted.has(name.toLowerCase())))
      return `The visible diagram (${names.join(', ')}) does not match the selected problem member ${member.id} ` +
        `(${member.startNodeId}-${member.endNodeId}).`;
  }
  if (target.kind === 'joint') {
    const accepted = target.id.toLowerCase();
    if (!names.some((name) => name.toLowerCase() === accepted))
      return `The visible diagram (${names.join(', ')}) does not match the selected problem joint ${target.id}.`;
  }
  if (target.kind === 'body') {
    const nodeIds = new Set(workspace.nodes.map((node) => node.id.toLowerCase()));
    const unknownEndpoint = names.find((name) => /^[A-Za-z]{2}$/.test(name) &&
      (!nodeIds.has(name[0].toLowerCase()) || !nodeIds.has(name[1].toLowerCase())));
    if (unknownEndpoint)
      return `The visible diagram (${unknownEndpoint}) includes endpoints that are not in the selected engineering structure.`;
  }
  return null;
}

/** Compares only student-created marks with external problem data; it never runs equilibrium. */
export function checkStudentFBD(workspace: StaticsWorkspace, state: FBDState): FBDCheckResult {
  const issues: FBDCheckIssue[] = [];
  const limitations: string[] = [];
  const checked = { appliedForces: 0, appliedMoments: 0, supportForceComponents: 0, supportMoments: 0 };
  const result = (status?: FBDCheckResult['status']): FBDCheckResult => ({
    status: status ?? (issues.length ? 'needs_revision' : limitations.length ? 'limited' : 'no_discrepancies'),
    selectedTarget: state.selectedTarget, issues, limitations, checked,
  });
  if (!state.selectedTarget) {
    issues.push({ kind: 'select_target', description: 'Select a body, member, or joint before checking its FBD.' });
    return result('needs_revision');
  }
  if (state.sourceStructureKey !== engineeringStructureKey(workspace)) {
    issues.push({ kind: 'stale_structure', description: 'The FBD belongs to an older structure. Reopen the diagram before checking it.' });
    return result('needs_revision');
  }
  const contextMismatch = diagramContextMismatch(workspace, state);
  if (contextMismatch) {
    issues.push({ kind: 'diagram_context_mismatch', description: `${contextMismatch} Select the matching problem object before checking.` });
    limitations.push('Loads and reactions were not compared because that would produce feedback about the wrong object.');
    return result('limited');
  }
  const given = selectGivenFBDInformation(workspace, state, DEFAULT_GIVEN_VISIBILITY);
  const nodes = new Map(workspace.nodes.map((node) => [node.id, node]));
  const span = Math.max(1, ...workspace.nodes.map((node) => Math.hypot(node.x, node.y)));
  const pointTolerance = Math.max(0.001, span * 0.015);
  const usedForces = new Set<string>();
  const usedMoments = new Set<string>();
  const nearbyForce = (point: FBDPoint) => state.forces.filter((force) =>
    !usedForces.has(force.id) && distance(force.at, point) <= pointTolerance);
  const nearbyMoment = (point: FBDPoint) => state.moments.filter((moment) =>
    !usedMoments.has(moment.id) && distance(moment.at, point) <= pointTolerance);

  for (const load of given.loads) {
    if (load.kind === 'distributed') {
      limitations.push(`Distributed load ${load.id} cannot be checked because student FBDState has no distributed-load element.`);
      continue;
    }
    const node = nodes.get(load.nodeId);
    if (!node) continue;
    if (load.kind === 'force') {
      checked.appliedForces++;
      const expectedAngle = degrees(load.angle, workspace.units) + (load.magnitude < 0 ? 180 : 0);
      const candidates = nearbyForce(node);
      const match = candidates.find((force) => angleGap(force.angle, expectedAngle) <= 15);
      if (match) {
        usedForces.add(match.id);
        if (match.magnitude !== undefined && Math.abs(match.magnitude - Math.abs(load.magnitude)) > 1e-6 * Math.max(1, Math.abs(load.magnitude)))
          issues.push({ kind: 'incorrect_given_magnitude', sourceId: load.id, elementId: match.id,
            description: `The entered magnitude for applied load at ${load.nodeId} differs from the given load.` });
      } else if (candidates.length) {
        usedForces.add(candidates[0].id);
        issues.push({ kind: 'incorrect_force_direction', sourceId: load.id, elementId: candidates[0].id,
          description: `The applied load at ${load.nodeId} points in the wrong direction.` });
      } else issues.push({ kind: 'omitted_applied_load', sourceId: load.id,
        description: `The given applied load at ${load.nodeId} is missing from your FBD.` });
    } else {
      checked.appliedMoments++;
      const expectedClockwise = load.magnitude < 0;
      const candidates = nearbyMoment(node);
      const match = candidates.find((moment) => moment.clockwise === expectedClockwise);
      if (match) usedMoments.add(match.id);
      else if (candidates.length) {
        usedMoments.add(candidates[0].id);
        issues.push({ kind: 'incorrect_moment_direction', sourceId: load.id, elementId: candidates[0].id,
          description: `The applied moment at ${load.nodeId} turns in the wrong direction.` });
      } else issues.push({ kind: 'missing_moment', sourceId: load.id,
        description: `The given applied moment at ${load.nodeId} is missing from your FBD.` });
    }
  }

  const visibleNodes = new Set(given.nodes.map((node) => node.id));
  for (const support of workspace.supports.filter((item) => visibleNodes.has(item.nodeId))) {
    const node = nodes.get(support.nodeId);
    if (!node) continue;
    const axes = support.kind === 'roller'
      ? [degrees(support.reactionAngle ?? (workspace.units.angle === 'rad' ? Math.PI / 2 : 90), workspace.units)]
      : [0, 90];
    for (const axis of axes) {
      checked.supportForceComponents++;
      const candidate = nearbyForce(node).find((force) => axisGap(force.angle, axis) <= 15);
      if (candidate) usedForces.add(candidate.id);
      else {
        const component = axisGap(axis, 0) <= 15 ? 'horizontal' : axisGap(axis, 90) <= 15 ? 'vertical' : 'normal';
        const wrongDirection = nearbyForce(node)[0];
        if (wrongDirection) usedForces.add(wrongDirection.id);
        issues.push({ kind: wrongDirection ? 'incorrect_support_reaction' : 'missing_force',
          sourceId: support.id, ...(wrongDirection ? { elementId: wrongDirection.id } : {}),
          description: `${support.kind === 'roller' ? 'Roller' : support.kind === 'pin' ? 'Pin' : 'Fixed'} support at ${support.nodeId} needs a ${component} reaction arrow${wrongDirection ? '; the arrow there follows a different axis' : ''}.` });
      }
    }
    if (support.kind === 'fixed') {
      checked.supportMoments++;
      const candidate = nearbyMoment(node)[0];
      if (candidate) usedMoments.add(candidate.id);
      else issues.push({ kind: 'missing_moment', sourceId: support.id,
        description: `Fixed support at ${support.nodeId} is missing a reaction moment.` });
    }
  }
  for (const force of state.forces.filter((item) => !usedForces.has(item.id)))
    issues.push({ kind: 'extra_force', elementId: force.id,
      description: `Force ${force.label || force.id} is not matched to a given load or expected support reaction.` });
  for (const moment of state.moments.filter((item) => !usedMoments.has(item.id)))
    issues.push({ kind: 'extra_moment', elementId: moment.id,
      description: `Moment ${moment.label || moment.id} is not matched to a given moment or fixed-support reaction.` });
  if (state.selectedTarget.kind === 'joint')
    limitations.push('For an isolated joint, member-end interaction forces cannot be inferred from the current problem model.');
  return result();
}

/** Questions about checking methodology do not start a check. */
export function explicitlyRequestsFBDCheck(message: string): boolean {
  const text = message.trim();
  if (/^(how|why|what)\b/i.test(text) || /\b(don't|do not|without|not yet)\s+(?:\w+\s+){0,2}(check|review|assess|evaluate|grade)\b/i.test(text)) return false;
  return /\b(check|review|assess|evaluate|grade)\b[\s\S]{0,80}\b(my|the|this)\s+(?:current\s+)?(?:fbd|free[ -]?body diagram)\b/i.test(text) ||
    /\b(is|does)\s+my\s+(?:fbd|free[ -]?body diagram)\s+(?:correct|right|complete)\b/i.test(text);
}

export function formatFBDCheckFeedback(check: FBDCheckResult): string {
  const heading = check.status === 'no_discrepancies'
    ? 'I found no discrepancies in the FBD elements this checker supports.'
    : check.status === 'limited' ? 'I could only check part of this FBD.' : 'Here is what to review in your FBD:';
  const findings = check.issues.map((issue) => `- ${issue.description}`);
  const limits = check.limitations.map((item) => `- Check limit: ${item}`);
  return [heading, ...findings, ...limits, '\nI did not change your FBD or calculate reaction values.'].join('\n');
}
