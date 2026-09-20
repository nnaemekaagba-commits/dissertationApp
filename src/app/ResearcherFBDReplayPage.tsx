import { useMemo, useState, type FormEvent } from 'react';
import { API_BASE_URL, AUTH_API_BASE_URL } from '/utils/api';
import type { EngineeringResearchEvent } from './statics/researchLog';
import type { FBDPoint, FBDState } from './statics/fbdState';
import type { StaticsWorkspace } from './statics/model';
import { buildFBDReplay, replaySessions, replayStructureIndex } from './statics/fbdReplay';

function ReplayCanvas({ state, workspace }: { state: FBDState; workspace?: StaticsWorkspace }) {
  const selected = state.selectedTarget;
  const nodes = new Map(workspace?.nodes.map((node) => [node.id, node]) || []);
  const members = !selected || !workspace ? [] : selected.kind === 'body'
    ? workspace.members : selected.kind === 'member'
      ? workspace.members.filter((member) => member.id === selected.id) : [];
  const visibleNodeIds = new Set(members.flatMap((member) => [member.startNodeId, member.endNodeId]));
  if (selected?.kind === 'joint') visibleNodeIds.add(selected.id);
  const points: FBDPoint[] = [
    ...[...visibleNodeIds].map((id) => nodes.get(id)).filter((node): node is NonNullable<typeof node> => !!node),
    ...state.forces.map((item) => item.at), ...state.moments.map((item) => item.at),
    ...state.dimensions.flatMap((item) => [item.start, item.end]),
    ...state.angles.flatMap((item) => [item.vertex, item.from, item.to]),
    ...state.labels.map((item) => item.at),
  ];
  const minX = Math.min(0, ...points.map((point) => point.x));
  const maxX = Math.max(1, ...points.map((point) => point.x));
  const minY = Math.min(0, ...points.map((point) => point.y));
  const maxY = Math.max(1, ...points.map((point) => point.y));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = Math.min(650 / Math.max(maxX - minX, 1), 310 / Math.max(maxY - minY, 1));
  const sx = (x: number) => 400 + (x - (minX + maxX) / 2) * scale;
  const sy = (y: number) => 220 - (y - (minY + maxY) / 2) * scale;
  const line = (a: FBDPoint, b: FBDPoint, color: string, width = 2) =>
    <line x1={sx(a.x)} y1={sy(a.y)} x2={sx(b.x)} y2={sy(b.y)} stroke={color} strokeWidth={width} />;
  const text = (value: string, at: FBDPoint, color: string) =>
    <text x={sx(at.x)} y={sy(at.y) - 8} textAnchor="middle" fill={color} fontSize="16"
      fontWeight="600" stroke="white" strokeWidth="4" paintOrder="stroke">{value}</text>;
  const anglePoint = (at: FBDPoint, radians: number, length: number) =>
    ({ x: at.x + Math.cos(radians) * length, y: at.y + Math.sin(radians) * length });
  const hasWork = state.forces.length + state.moments.length + state.dimensions.length +
    state.angles.length + state.labels.length > 0;

  return <svg viewBox="0 0 800 440" role="img" aria-label="Read-only FBD replay"
    className="h-full min-h-[360px] w-full rounded border border-slate-200 bg-slate-50">
    <defs><marker id="replay-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5"
      orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#dc2626" /></marker>
      <marker id="replay-moment-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5"
        orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#7c3aed" /></marker></defs>
    {hasWork && members.map((member) => {
      const a = nodes.get(member.startNodeId); const b = nodes.get(member.endNodeId);
      return a && b ? <g key={member.id}>{line(a, b, '#059669', 7)}</g> : null;
    })}
    {hasWork && [...visibleNodeIds].map((id) => {
      const node = nodes.get(id);
      return node ? <g key={id}><circle cx={sx(node.x)} cy={sy(node.y)} r="5" fill="#047857" />
        {text(node.label || node.id, { x: node.x, y: node.y + span * 0.09 }, '#065f46')}</g> : null;
    })}
    {state.forces.map((force) => {
      const end = anglePoint(force.at, force.angle * Math.PI / 180, Math.max(0.75, span * 0.22));
      return <g key={force.id}><line x1={sx(force.at.x)} y1={sy(force.at.y)} x2={sx(end.x)} y2={sy(end.y)}
        stroke="#dc2626" strokeWidth="3" markerEnd="url(#replay-arrow)" />
        {text(`${force.label || 'F'}${force.magnitude === undefined ? '' : ` = ${force.magnitude}`}`,
          force.labelPosition || end, '#991b1b')}</g>;
    })}
    {state.moments.map((moment) => {
      const radius = Math.max(0.3, span * 0.1);
      const arc = Array.from({ length: 33 }, (_, index) => anglePoint(moment.at,
        -3 * Math.PI / 4 + (moment.clockwise ? -1 : 1) * 3 * Math.PI / 2 * index / 32, radius));
      return <g key={moment.id}><polyline points={arc.map((point) => `${sx(point.x)},${sy(point.y)}`).join(' ')}
        fill="none" stroke="#7c3aed" strokeWidth="3" markerEnd="url(#replay-moment-arrow)" />
        {text(`${moment.label || 'M'}${moment.magnitude === undefined ? '' : ` = ${moment.magnitude}`}`,
          moment.labelPosition || { x: moment.at.x, y: moment.at.y + radius * 1.6 }, '#6d28d9')}</g>;
    })}
    {state.dimensions.map((dimension) => {
      const dx = dimension.end.x - dimension.start.x;
      const dy = dimension.end.y - dimension.start.y;
      const length = Math.hypot(dx, dy) || 1;
      const offset = Math.max(0.3, span * 0.1);
      const normal = { x: -dy / length * offset, y: dx / length * offset };
      const a = { x: dimension.start.x + normal.x, y: dimension.start.y + normal.y };
      const b = { x: dimension.end.x + normal.x, y: dimension.end.y + normal.y };
      return <g key={dimension.id}>{line(dimension.start, a, '#0891b2')}
        {line(a, b, '#0891b2')}{line(b, dimension.end, '#0891b2')}
        {text(dimension.label || '', dimension.labelPosition ||
          { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, '#0e7490')}</g>;
    })}
    {state.angles.map((angle) => {
      const start = Math.atan2(angle.from.y - angle.vertex.y, angle.from.x - angle.vertex.x);
      const end = Math.atan2(angle.to.y - angle.vertex.y, angle.to.x - angle.vertex.x);
      const sweep = Math.atan2(Math.sin(end - start), Math.cos(end - start));
      const radius = Math.max(0.28, span * 0.08);
      const arc = Array.from({ length: 25 }, (_, index) => anglePoint(angle.vertex,
        start + sweep * index / 24, radius));
      return <g key={angle.id}>{line(angle.vertex, angle.from, '#0d9488')}
        {line(angle.vertex, angle.to, '#0d9488')}
        <polyline points={arc.map((point) => `${sx(point.x)},${sy(point.y)}`).join(' ')}
          fill="none" stroke="#0d9488" strokeWidth="2" />
        {text(angle.label || '', angle.labelPosition || anglePoint(angle.vertex,
          start + sweep / 2, radius * 1.5), '#0f766e')}</g>;
    })}
    {state.labels.map((label) => <g key={label.id}>{text(label.text, label.at, '#1e293b')}</g>)}
    {!hasWork && <text x="400" y="220" textAnchor="middle" fill="#64748b" fontSize="18">
      No student-created FBD elements at this step.</text>}
  </svg>;
}

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
