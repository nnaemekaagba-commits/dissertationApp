import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { parseStaticsWorkspace, type StaticsWorkspace } from './model';
import { loadStaticsWorkspace, saveStaticsWorkspace } from './storage';
import { applyFBDChange, associateFBDState, createFBDHistory, loadFBDState,
  parseFBDState, redoFBDChange, saveFBDState, undoFBDChange,
  type FBDHistory, type FBDState } from './fbdState';

interface StaticsWorkspaceContextValue {
  workspace: StaticsWorkspace;
  setWorkspace: (next: StaticsWorkspace | ((current: StaticsWorkspace) => StaticsWorkspace)) => void;
  fbdState: FBDState;
  setFbdState: (next: FBDState | ((current: FBDState) => FBDState)) => void;
  undoFbd: () => void;
  redoFbd: () => void;
  canUndoFbd: boolean;
  canRedoFbd: boolean;
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
  const [fbdHistory, setFbdHistory] = useState<FBDHistory>(() =>
    createFBDHistory(loadFBDState(localStorage, userId, workspace)));
  const fbdHistoryRef = useRef(fbdHistory);
  const setWorkspace: StaticsWorkspaceContextValue['setWorkspace'] = (next) => {
    const parsed = parseStaticsWorkspace(typeof next === 'function' ? next(workspaceRef.current) : next);
    workspaceRef.current = parsed;
    setState(parsed);
    const current = fbdHistoryRef.current;
    const associated = { present: associateFBDState(current.present, parsed),
      past: current.past.map((item) => associateFBDState(item, parsed)),
      future: current.future.map((item) => associateFBDState(item, parsed)) };
    fbdHistoryRef.current = associated;
    setFbdHistory(associated);
  };
  const setFbdState: StaticsWorkspaceContextValue['setFbdState'] = (next) => {
    const current = fbdHistoryRef.current;
    const value = parseFBDState(typeof next === 'function' ? next(current.present) : next, workspaceRef.current);
    const updated = applyFBDChange(current, value);
    fbdHistoryRef.current = updated;
    setFbdHistory(updated);
  };
  const undoFbd = () => {
    const updated = undoFBDChange(fbdHistoryRef.current);
    fbdHistoryRef.current = updated;
    setFbdHistory(updated);
  };
  const redoFbd = () => {
    const updated = redoFBDChange(fbdHistoryRef.current);
    fbdHistoryRef.current = updated;
    setFbdHistory(updated);
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

  useEffect(() => {
    try { saveFBDState(localStorage, userId, fbdHistory.present, workspace); }
    catch (error) { console.warn('Could not save student FBD on this device.', error); }
  }, [userId, fbdHistory.present, workspace]);

  const value = useMemo<StaticsWorkspaceContextValue>(() => ({
    workspace, setWorkspace, fbdState: fbdHistory.present, setFbdState,
    undoFbd, redoFbd, canUndoFbd: fbdHistory.past.length > 0,
    canRedoFbd: fbdHistory.future.length > 0,
  }), [workspace, fbdHistory]);

  return <StaticsWorkspaceContext.Provider value={value}>{children}</StaticsWorkspaceContext.Provider>;
});

export function useStaticsWorkspace(): StaticsWorkspaceContextValue {
  const context = useContext(StaticsWorkspaceContext);
  if (!context) throw new Error('useStaticsWorkspace must be used inside StaticsWorkspaceProvider');
  return context;
}
