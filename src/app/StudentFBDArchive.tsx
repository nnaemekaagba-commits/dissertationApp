import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '/utils/api';
import type { EngineeringResearchEvent } from './statics/researchLog';
import { loadLocalResearchEvents } from './statics/researchLog';
import { buildFBDReplay, replaySessions, replayStructureIndex } from './statics/fbdReplay';
import { ReplayCanvas } from './FBDReplayCanvas';

/** Reads only the signed-in student's research events; no replay action writes data. */
export function StudentFBDArchive({ accessToken, userId }: { accessToken: string | null; userId: string }) {
  const [events, setEvents] = useState<EngineeringResearchEvent[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const sessions = useMemo(() => replaySessions(events), [events]);
  const steps = useMemo(() => buildFBDReplay(events, sessionId), [events, sessionId]);
  const structures = useMemo(() => replayStructureIndex(events), [events]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const local = loadLocalResearchEvents(localStorage, userId);
      if (!accessToken) {
        setEvents(local); setSessionId((current) => replaySessions(local).includes(current)
          ? current : replaySessions(local)[0] || ''); setStepIndex(0); setLoaded(true); return;
      }
      const response = await fetch(`${API_BASE_URL}/engineering-events`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error('AWS FBD history is unavailable; showing this device’s saved history.');
      const data = await response.json();
      const remote = Array.isArray(data.events) ? data.events as EngineeringResearchEvent[] : [];
      const byId = new Map([...local, ...remote].map((event) => [event.eventId, event]));
      const next = [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      setEvents(next);
      setSessionId((current) => replaySessions(next).includes(current) ? current : replaySessions(next)[0] || '');
      setStepIndex(0);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your FBD history.');
      const local = loadLocalResearchEvents(localStorage, userId);
      setEvents(local); setSessionId((current) => replaySessions(local).includes(current)
        ? current : replaySessions(local)[0] || ''); setStepIndex(0); setLoaded(true);
    } finally { setLoading(false); }
  }, [accessToken, userId]);

  useEffect(() => { void load(); }, [load]);

  return <section aria-label="My FBD History" className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div><h3 className="font-semibold">My FBD History</h3>
        <p className="text-xs text-slate-500">A read-only record of FBD actions saved for this {accessToken ? 'account' : 'guest session'}.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading}
        className="rounded border px-2 py-1 text-xs disabled:opacity-50">Refresh</button>
    </div>
    {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
    {loading && <p className="text-sm text-slate-500">Loading FBD history…</p>}
    {loaded && sessions.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-600">
      No FBD construction history has been recorded for this account yet.</p>}
    {sessions.length > 0 && <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">Session<select value={sessionId} onChange={(event) => {
          setSessionId(event.target.value); setStepIndex(0);
        }} className="mt-1 block max-w-full rounded border p-2 text-xs">
          {sessions.map((id) => <option key={id} value={id}>{id}</option>)}
        </select></label>
        <button type="button" onClick={() => setStepIndex((value) => value - 1)}
          disabled={stepIndex === 0} className="rounded border px-2 py-1 text-xs disabled:opacity-40">Previous</button>
        <span className="text-xs">Step {stepIndex} of {Math.max(steps.length - 1, 0)}</span>
        <button type="button" onClick={() => setStepIndex((value) => value + 1)}
          disabled={stepIndex >= steps.length - 1} className="rounded border px-2 py-1 text-xs disabled:opacity-40">Next</button>
      </div>
      {step && <div className="space-y-2">
        <p className="text-sm"><strong>{step.actionType}</strong>
          {step.timestamp && <> · {new Date(step.timestamp).toLocaleString()}</>}
          {step.elementType && <> · {step.elementType} {step.elementId}</>}</p>
        <ReplayCanvas state={step.state} workspace={structures.get(step.problemId)} />
        {step.studentMessage && <div className="rounded border bg-blue-50 p-2 text-sm">
          <strong>What you said:</strong> <span className="whitespace-pre-wrap">{step.studentMessage}</span>
          {step.inputModality && <span className="ml-2 text-xs text-slate-500">({step.inputModality})</span>}
        </div>}
        <details className="rounded border p-2"><summary className="cursor-pointer text-sm font-medium">FBDState at this step</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{
            JSON.stringify(step.state, null, 2)}</pre>
        </details>
      </div>}
    </>}
  </section>;
}
