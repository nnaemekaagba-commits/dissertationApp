import { createStaticsWorkspace, parseStaticsWorkspace, type StaticsWorkspace } from './model.ts';

export interface StaticsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const staticsStorageKey = (userId: string) => `mydis-statics:v1:${encodeURIComponent(userId)}`;

export function loadStaticsWorkspace(storage: StaticsStorage, userId: string): StaticsWorkspace {
  if (!userId.trim()) throw new Error('User id is required');
  try {
    const saved = storage.getItem(staticsStorageKey(userId));
    return saved ? parseStaticsWorkspace(JSON.parse(saved)) : createStaticsWorkspace();
  } catch (error) {
    console.warn('Could not restore statics workspace; starting with an empty workspace.', error);
    return createStaticsWorkspace();
  }
}

export function saveStaticsWorkspace(storage: StaticsStorage, userId: string, workspace: StaticsWorkspace): void {
  if (!userId.trim()) throw new Error('User id is required');
  storage.setItem(staticsStorageKey(userId), JSON.stringify(parseStaticsWorkspace(workspace)));
}
