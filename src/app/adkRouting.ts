const FBD_TOPIC = /\b(fbd|free[ -]?body|rigid body|support|reaction|force|moment|member|beam|joint|equilibrium)\b/i;
const ADVICE_SHAPE = /\?|^(what|why|how|am i|is|are|should|could|can|do|does|help|explain|review|check)\b/i;
const MUTATION_REQUEST = /\b(add|create|draw|insert|delete|remove|move|drag|edit|change|rotate|tilt|reset|clear|modify|update)\b/i;
const CALCULATION_REQUEST = /\b(calculate|compute|solve|find|determine)\b|\b(numerical|numeric)\s+(answer|result|value)|\bwhat is the (value|magnitude)\b/i;

export function shouldUseADKFBDCoach(message: string, hasVisibleFBD: boolean,
  adkApiBaseUrl?: string): boolean {
  const text = message.trim();
  return Boolean(adkApiBaseUrl && hasVisibleFBD && FBD_TOPIC.test(text) && ADVICE_SHAPE.test(text) &&
    !MUTATION_REQUEST.test(text) && !CALCULATION_REQUEST.test(text));
}
