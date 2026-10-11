export type WebSearchContext = { hasVisibleFBD: boolean; hasAttachments: boolean };
export type GroundingSource = { title: string; url: string; snippet?: string; source?: string };

const explicitSearch = /\b(search|browse|look up|find online|check online|use (?:web|internet)|web sources?|online sources?|cite sources?|references?)\b/i;
const freshness = /\b(latest|current|currently|today|recent|recently|newest|updated?|this (?:week|month|year)|as of)\b/i;
const volatileTopic = /\b(news|weather|forecast|price|cost|stock|exchange rate|law|regulation|code requirement|standard|specification|version|release|schedule|score|election|president|governor|ceo)\b/i;
const highStakes = /\b(medical|medicine|symptom|diagnosis|treatment|legal|lawsuit|tax|investment|financial advice|safety standard)\b/i;
const diagramGrounded = /\b(fbd|free[ -]?body|rigid body|diagram|canvas|member|support reaction|force arrow|moment arrow)\b/i;
const localReference = /\b(this|attached|uploaded|my)\s+(image|file|document|problem|diagram|fbd)\b/i;
const calculation = /\b(calculate|compute|solve|equilibrium|reaction forces?|sum of (?:forces|moments))\b/i;

export function shouldAutomaticallySearchWeb(query: string, context: WebSearchContext): boolean {
  const text = query.trim();
  if (!text) return false;
  if (explicitSearch.test(text)) return true;
  if ((context.hasVisibleFBD && diagramGrounded.test(text)) ||
    (context.hasAttachments && localReference.test(text))) return false;
  if (calculation.test(text) && !freshness.test(text) && !volatileTopic.test(text)) return false;
  return freshness.test(text) || volatileTopic.test(text) || highStakes.test(text);
}

export function buildWebGroundedRequest(query: string, sources: GroundingSource[]): string {
  if (!sources.length) return query;
  const evidence = sources.slice(0, 5).map((item, index) =>
    `${index + 1}. ${item.title}\nURL: ${item.url}${item.source ? `\nPublisher: ${item.source}` : ''}${item.snippet ? `\nSnippet: ${item.snippet}` : ''}`)
    .join('\n\n');
  return `${query}

WEB RESEARCH CONTEXT:
Use the sources below only where they support the answer. Cite factual claims inline with Markdown links using the exact source URL. Distinguish sourced facts from inference. If the sources do not answer the question, say so rather than inventing information.

${evidence}`;
}
