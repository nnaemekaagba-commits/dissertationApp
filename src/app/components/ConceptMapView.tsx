import { Brain, MoveRight } from 'lucide-react';
import type { ConceptMap, ConceptMapNodeKind } from './conceptMap';

const styles: Record<ConceptMapNodeKind, string> = {
  question: 'border-purple-400 bg-purple-50 text-purple-950',
  given: 'border-blue-300 bg-blue-50 text-blue-950',
  unknown: 'border-amber-300 bg-amber-50 text-amber-950',
  principle: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  representation: 'border-cyan-300 bg-cyan-50 text-cyan-950',
  check: 'border-rose-300 bg-rose-50 text-rose-950',
};

export function ConceptMapView({ map }: { map: ConceptMap }) {
  const central = map.nodes.find((node) => node.kind === 'question')!;
  const branches = map.nodes.filter((node) => node.id !== central.id);
  return <section className="rounded-lg border border-purple-200 bg-white p-3" aria-label={`Concept map: ${map.title}`}>
    <div className="mb-3 flex items-center gap-2 text-purple-900"><Brain className="size-5" />
      <h3 className="font-semibold">{map.title}</h3></div>
    <div className={`mx-auto max-w-lg rounded-lg border-2 p-3 text-center ${styles.question}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">Question</div>
      <div className="font-semibold">{central.label}</div>
      {central.prompt && <p className="mt-1 text-xs">{central.prompt}</p>}
    </div>
    <div className="my-2 text-center text-purple-400">↓</div>
    <div className="grid gap-2 sm:grid-cols-2">
      {branches.map((node) => <article key={node.id} className={`rounded-lg border p-2.5 ${styles[node.kind]}`}>
        <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">{node.kind}</div>
        <div className="text-sm font-semibold">{node.label}</div>
        {node.prompt && <p className="mt-1 text-xs">{node.prompt}</p>}
        {map.edges.filter((edge) => edge.to === node.id || edge.from === node.id).slice(0, 2).map((edge, index) =>
          <div key={`${edge.from}-${edge.to}-${index}`} className="mt-1 flex items-center gap-1 text-[10px] opacity-70">
            <MoveRight className="size-3" />{edge.label || 'relates to'}
          </div>)}
      </article>)}
    </div>
    <p className="mt-3 text-xs text-slate-600">Use the prompts to decide your next step. The map does not change the FBD or run calculations.</p>
  </section>;
}
