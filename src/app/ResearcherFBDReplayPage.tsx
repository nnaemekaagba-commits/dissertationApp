import { useMemo, useState, type FormEvent } from 'react';
import { API_BASE_URL, AUTH_API_BASE_URL } from '/utils/api';
import type { EngineeringResearchEvent } from './statics/researchLog';
import { buildFBDReplay, replaySessions, replayStructureIndex } from './statics/fbdReplay';
import { ReplayCanvas } from './FBDReplayCanvas';

export default function ResearcherFBDReplayPage() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [studentIdInput, setStudentIdInput] = useState('');
  const [events, setEvents] = useState<EngineeringResearchEvent[]>([]);
  const [structureEvents, setStructureEvents] = useState<EngineeringResearchEvent[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const sessions = useMemo(() => replaySessions(events), [events]);
  const steps = useMemo(() => buildFBDReplay(events, sessionId), [events, sessionId]);
  const structures = useMemo(() => replayStructureIndex(structureEvents), [structureEvents]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  const signIn = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const response = await fetch(`${AUTH_API_BASE_URL}/signin`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok || !data.access_token) throw new Error(data.error || 'Sign in failed.');
      const accessToken = data.access_token as string;
      const access = await fetch(`${API_BASE_URL}/researcher/me`, {
        headers: { Authorization: `Bearer ${accessToken}` } });
      if (!access.ok) throw new Error(access.status === 403
        ? `Researcher access is not configured for account ${data.user?.id || ''}.`
        : 'Could not verify researcher access.');
      setToken(accessToken); setPassword('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Sign in failed.'); }
    finally { setLoading(false); }
  };

  const loadReplay = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const studentId = studentIdInput.trim();
      if (!/^[a-f0-9]{32}$/i.test(studentId)) throw new Error('Enter the student’s 32-character account ID.');
      const response = await fetch(`${API_BASE_URL}/researcher/fbd-events/${studentId}`, {
        headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load replay.');
      const loaded = data.events as EngineeringResearchEvent[];
      setEvents(loaded); setStructureEvents(data.structureEvents || []);
      setSessionId(replaySessions(loaded)[0] || ''); setStepIndex(0);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load replay.'); }
    finally { setLoading(false); }
  };

  return <main className="min-h-screen bg-slate-100 p-4 text-slate-900 md:p-8">
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="rounded-lg bg-slate-900 p-5 text-white">
        <h1 className="text-xl font-semibold">FBD construction replay</h1>
        <p className="mt-1 text-sm text-slate-300">Researcher view · Read-only student snapshots</p>
      </header>
      {!token ? <form onSubmit={signIn} className="mx-auto max-w-md space-y-3 rounded-lg bg-white p-6 shadow">
        <h2 className="font-semibold">Researcher sign in</h2>
        <label className="block text-sm">Email<input type="email" required value={email}
          onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm">Password<input type="password" required value={password}
          onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <button disabled={loading} className="rounded bg-indigo-700 px-4 py-2 text-white disabled:opacity-50">Sign in</button>
      </form> : <>
        <div className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4 shadow">
          <form onSubmit={loadReplay} className="flex flex-wrap items-end gap-2">
            <label className="text-sm">Student account ID<input value={studentIdInput} required
              onChange={(event) => setStudentIdInput(event.target.value)}
              className="mt-1 block w-80 max-w-full rounded border p-2 font-mono text-sm" /></label>
            <button disabled={loading} className="rounded bg-indigo-700 px-4 py-2 text-white disabled:opacity-50">Load replay</button>
          </form>
          <button type="button" onClick={() => { setToken(''); setEvents([]); setStructureEvents([]); }}
            className="ml-auto rounded border px-3 py-2 text-sm">Sign out</button>
        </div>
        {sessions.length > 0 && <section className="space-y-3 rounded-lg bg-white p-4 shadow">
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">Session<select value={sessionId} onChange={(event) => {
              setSessionId(event.target.value); setStepIndex(0);
            }} className="mt-1 block rounded border p-2">
              {sessions.map((id) => <option key={id} value={id}>{id}</option>)}
            </select></label>
            <div className="flex items-center gap-2">
              <button type="button" disabled={stepIndex <= 0} onClick={() => setStepIndex((value) => value - 1)}
                className="rounded border px-3 py-2 disabled:opacity-40">Previous step</button>
              <span className="text-sm">{stepIndex} / {Math.max(steps.length - 1, 0)}</span>
              <button type="button" disabled={stepIndex >= steps.length - 1}
                onClick={() => setStepIndex((value) => value + 1)}
                className="rounded border px-3 py-2 disabled:opacity-40">Next step</button>
            </div>
          </div>
          {step && <><div className="text-sm"><strong>{step.actionType}</strong>
            {step.timestamp && <> · {new Date(step.timestamp).toLocaleString()}</>}
            {step.elementType && <> · {step.elementType} {step.elementId}</>}
            <div className="text-slate-500">Problem {step.problemId} · Isolated object: {
              step.state.selectedTarget ? `${step.state.selectedTarget.kind} ${step.state.selectedTarget.id}` : 'none'}</div>
          </div>
          <ReplayCanvas state={step.state} workspace={structures.get(step.problemId)} />
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded border p-3"><h2 className="mb-2 font-semibold">Student chat message</h2>
              <p className="whitespace-pre-wrap text-sm">{step.studentMessage || 'No chat message for this action.'}</p>
              {step.inputModality && <p className="mt-2 text-xs text-slate-500">Input: {step.inputModality}</p>}
            </section>
            <section className="rounded border p-3"><h2 className="mb-2 font-semibold">FBDState at this step</h2>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{
                JSON.stringify(step.state, null, 2)}</pre></section>
          </div></>}
        </section>}
        {events.length === 0 && <p className="rounded bg-white p-4 text-sm text-slate-600">Load a student account to view its recorded FBD sessions.</p>}
        {events.length > 0 && sessions.length === 0 && <p className="rounded bg-white p-4 text-sm text-slate-600">No replayable FBD snapshots were recorded for this account.</p>}
      </>}
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </div>
  </main>;
}
