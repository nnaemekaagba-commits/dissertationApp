import type { BeamReactionResult } from './calculations.ts';
import type { StaticsWorkspace } from './model.ts';
import { engineeringStructureKey } from './fbdState.ts';

export type RequestedVisualCalculation = { structureKey: string; result: BeamReactionResult };

/** Questions about method and negated requests do not authorize solving. */
export function explicitlyRequestsCalculation(message: string): boolean {
  const text = message.trim();
  if (/^(how|why|explain|teach)\b/i.test(text) ||
    /\b(don't|do not|without|not yet)\s+(?:\w+\s+){0,2}(calculate|compute|solve|find|show|display)\b/i.test(text)) return false;
  return /\b(calculate|compute|solve|find|give|show|display|what are)\b[\s\S]{0,100}\b(reactions?|reaction forces?|support forces?|equilibrium results?)\b/i.test(text) ||
    /\b(reactions?|support forces?)\b[\s\S]{0,50}\b(calculate|compute|solve)\b/i.test(text);
}

/** A numerical answer in chat is the default; diagram arrows require a separate display intent. */
export function explicitlyRequestsVisualCalculation(message: string): boolean {
  return explicitlyRequestsCalculation(message) &&
    /\b(show|display|draw|plot|render|visuali[sz]e)\b[\s\S]{0,100}\b(reactions?|support forces?|results?)\b[\s\S]{0,100}\b(diagram|structure|viewer|view|3d|arrows?|vectors?|canvas|visual(?:ly)?)\b/i.test(message) ||
    explicitlyRequestsCalculation(message) &&
    /\b(show|display|draw|plot|render|visuali[sz]e)\b[\s\S]{0,100}\b(reaction arrows?)\b/i.test(message);
}

export function visualCalculationForRequest(message: string, workspace: StaticsWorkspace,
  result: BeamReactionResult): RequestedVisualCalculation | null {
  return explicitlyRequestsVisualCalculation(message)
    ? { structureKey: engineeringStructureKey(workspace), result } : null;
}

/** Previously requested arrows disappear as soon as the engineering problem changes. */
export function visibleCalculation(workspace: StaticsWorkspace,
  requested: RequestedVisualCalculation | null): BeamReactionResult | null {
  return requested?.structureKey === engineeringStructureKey(workspace) ? requested.result : null;
}
