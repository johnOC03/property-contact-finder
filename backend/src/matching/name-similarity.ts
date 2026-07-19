import { jaroWinklerSimilarity } from './jaro-winkler';

const NAME_TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'dame', 'prof']);

/**
 * Lower-cases, strips punctuation/titles, and drops single-letter tokens
 * (middle initials) so "Mr John A. Smith" and "John Smith" normalize the same.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !NAME_TITLES.has(token))
    .join(' ')
    .trim();
}

/** Name similarity, weighted 0-40 points per IMPLEMENTATION_PLAN.md section 6. */
export function nameSimilarityScore(inputName: string, candidateName: string): number {
  const a = normalizeName(inputName);
  const b = normalizeName(candidateName);
  if (!a || !b) return 0;

  const similarity = jaroWinklerSimilarity(a, b);
  return Math.round(similarity * 40);
}
