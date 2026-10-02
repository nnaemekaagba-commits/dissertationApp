export type ConceptMapNodeKind = 'question' | 'given' | 'unknown' | 'principle' | 'representation' | 'check';
export type ConceptMapNode = { id: string; label: string; kind: ConceptMapNodeKind; prompt?: string };
export type ConceptMapEdge = { from: string; to: string; label?: string };
export type ConceptMap = { title: string; nodes: ConceptMapNode[]; edges: ConceptMapEdge[] };

const kinds = new Set<ConceptMapNodeKind>(['question', 'given', 'unknown', 'principle', 'representation', 'check']);
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

export function parseConceptMap(content: string): ConceptMap | null {
  let stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!stripped.startsWith('{')) {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) stripped = stripped.slice(start, end + 1);
  }
  if (!stripped.startsWith('{')) return null;
  try {
    const value = JSON.parse(stripped) as Record<string, unknown>;
    if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
    const nodes = value.nodes.slice(0, 12).map((item) => {
      const source = item as Record<string, unknown>;
      const kind = text(source.kind, 20) as ConceptMapNodeKind;
      return { id: text(source.id, 40), label: text(source.label, 100), kind,
        ...(text(source.prompt, 180) ? { prompt: text(source.prompt, 180) } : {}) };
    }).filter((node) => node.id && node.label && kinds.has(node.kind));
    if (!nodes.length || !nodes.some((node) => node.kind === 'question')) return null;
    const ids = new Set(nodes.map((node) => node.id));
    if (ids.size !== nodes.length) return null;
    const edges = value.edges.slice(0, 18).map((item) => {
      const source = item as Record<string, unknown>;
      return { from: text(source.from, 40), to: text(source.to, 40),
        ...(text(source.label, 60) ? { label: text(source.label, 60) } : {}) };
    }).filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
    return { title: text(value.title, 100) || 'Concept map', nodes, edges };
  } catch {
    return null;
  }
}

export function buildConceptMapRequest(question: string, priorAnswer: string,
  engineeringState: unknown, fbdState: unknown): string {
  return [
    'Create a concept map that helps the student reason about the question. Do not solve the problem and do not calculate numerical results.',
    'Use the supplied rigid-body/engineering state and student-built FBD state as evidence. Do not invent supports, loads, members, or dimensions.',
    'Return JSON only, with this exact shape:',
    '{"title":"...","nodes":[{"id":"q","label":"...","kind":"question","prompt":"..."}],"edges":[{"from":"q","to":"...","label":"..."}]}',
    'Allowed node kinds: question, given, unknown, principle, representation, check.',
    'Use 6 to 10 short nodes. Include one central question node, relevant givens, unknowns, governing statics principles, a representation/FBD idea, and questions that prompt the student to check their own reasoning.',
    '',
    `Student question: ${question}`,
    `Prior explanation: ${priorAnswer}`,
    `Rigid-body/engineering state: ${JSON.stringify(engineeringState ?? null)}`,
    `Student FBD state: ${JSON.stringify(fbdState ?? null)}`,
  ].join('\n');
}
