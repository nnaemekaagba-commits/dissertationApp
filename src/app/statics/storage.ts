import { createSimplySupportedBeamWorkspace, parseStaticsWorkspace, type StaticsWorkspace } from './model.ts';

export interface StaticsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const staticsStorageKey = (userId: string) => `mydis-statics:v2:${encodeURIComponent(userId)}`;
const legacyStorageKey = (userId: string) => `mydis-statics:v1:${encodeURIComponent(userId)}`;

export function loadStaticsWorkspace(storage: StaticsStorage, userId: string): StaticsWorkspace {
  if (!userId.trim()) throw new Error('User id is required');
  try {
    const saved = storage.getItem(staticsStorageKey(userId));
    if (saved) return parseStaticsWorkspace(JSON.parse(saved));
    const legacy = storage.getItem(legacyStorageKey(userId));
    if (!legacy) return createSimplySupportedBeamWorkspace();
    const workspace = parseStaticsWorkspace(JSON.parse(legacy));
    // Earlier versions persisted an empty state while showing an unsaved test beam.
    return workspace.nodes.length === 0 && workspace.members.length === 0 &&
      workspace.supports.length === 0 && workspace.loads.length === 0 &&
      workspace.dimensions.length === 0 && !workspace.angles?.length
      ? createSimplySupportedBeamWorkspace() : workspace;
  } catch (error) {
    console.warn('Could not restore statics workspace; starting with the beam workspace.', error);
    return createSimplySupportedBeamWorkspace();
  }
}

export function saveStaticsWorkspace(storage: StaticsStorage, userId: string, workspace: StaticsWorkspace): void {
  if (!userId.trim()) throw new Error('User id is required');
  storage.setItem(staticsStorageKey(userId), JSON.stringify(parseStaticsWorkspace(workspace)));
}
