import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { parseStaticsWorkspace, type StaticsWorkspace } from './model';
import { loadStaticsWorkspace, saveStaticsWorkspace } from './storage';

interface StaticsWorkspaceContextValue {
  workspace: StaticsWorkspace;
  setWorkspace: (next: StaticsWorkspace | ((current: StaticsWorkspace) => StaticsWorkspace)) => void;
}

const StaticsWorkspaceContext = createContext<StaticsWorkspaceContextValue | null>(null);

export interface StaticsWorkspaceController {
  getWorkspace: () => StaticsWorkspace;
  setWorkspace: StaticsWorkspaceContextValue['setWorkspace'];
}

/** Mount with key={userId} so a different account never inherits the prior account's state. */
export const StaticsWorkspaceProvider = forwardRef<StaticsWorkspaceController, { userId: string; children: ReactNode }>(
function StaticsWorkspaceProvider({ userId, children }, controllerRef) {
  const [workspace, setState] = useState(() => loadStaticsWorkspace(localStorage, userId));
  const workspaceRef = useRef(workspace);
  const setWorkspace: StaticsWorkspaceContextValue['setWorkspace'] = (next) => {
    const parsed = parseStaticsWorkspace(typeof next === 'function' ? next(workspaceRef.current) : next);
    workspaceRef.current = parsed;
    setState(parsed);
  };

  // Chat runs in the parent App; this controller points at the same provider state.
  useImperativeHandle(controllerRef, () => ({ getWorkspace: () => workspaceRef.current, setWorkspace }));

  useEffect(() => {
    try {
      saveStaticsWorkspace(localStorage, userId, workspace);
    } catch (error) {
      console.warn('Could not save statics workspace on this device.', error);
    }
  }, [userId, workspace]);

  const value = useMemo<StaticsWorkspaceContextValue>(() => ({
    workspace,
    setWorkspace,
  }), [workspace]);

  return <StaticsWorkspaceContext.Provider value={value}>{children}</StaticsWorkspaceContext.Provider>;
});

export function useStaticsWorkspace(): StaticsWorkspaceContextValue {
  const context = useContext(StaticsWorkspaceContext);
  if (!context) throw new Error('useStaticsWorkspace must be used inside StaticsWorkspaceProvider');
  return context;
}
