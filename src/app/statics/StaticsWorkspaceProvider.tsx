import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { parseStaticsWorkspace, type StaticsWorkspace } from './model';
import { loadStaticsWorkspace, saveStaticsWorkspace } from './storage';

interface StaticsWorkspaceContextValue {
  workspace: StaticsWorkspace;
  setWorkspace: (next: StaticsWorkspace | ((current: StaticsWorkspace) => StaticsWorkspace)) => void;
}

const StaticsWorkspaceContext = createContext<StaticsWorkspaceContextValue | null>(null);

/** Mount with key={userId} so a different account never inherits the prior account's state. */
export function StaticsWorkspaceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [workspace, setState] = useState(() => loadStaticsWorkspace(localStorage, userId));

  useEffect(() => {
    try {
      saveStaticsWorkspace(localStorage, userId, workspace);
    } catch (error) {
      console.warn('Could not save statics workspace on this device.', error);
    }
  }, [userId, workspace]);

  const value = useMemo<StaticsWorkspaceContextValue>(() => ({
    workspace,
    setWorkspace: (next) => setState((current) =>
      parseStaticsWorkspace(typeof next === 'function' ? next(current) : next)),
  }), [workspace]);

  return <StaticsWorkspaceContext.Provider value={value}>{children}</StaticsWorkspaceContext.Provider>;
}

export function useStaticsWorkspace(): StaticsWorkspaceContextValue {
  const context = useContext(StaticsWorkspaceContext);
  if (!context) throw new Error('useStaticsWorkspace must be used inside StaticsWorkspaceProvider');
  return context;
}
