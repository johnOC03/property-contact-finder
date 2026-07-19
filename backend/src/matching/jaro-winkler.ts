/**
 * Jaro-Winkler string similarity. Pure, dependency-free implementation so the
 * matching engine's scoring is fully explainable/auditable (see
 * IMPLEMENTATION_PLAN.md section 6).
 *
 * Returns a value in [0, 1] — 1 means identical strings.
 */
export function jaroSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aMatches = new Array<boolean>(aLen).fill(false);
  const bMatches = new Array<boolean>(bLen).fill(false);

  let matches = 0;
  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, bLen);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < aLen; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions = transpositions / 2;

  return (matches / aLen + matches / bLen + (matches - transpositions) / matches) / 3;
}

/**
 * Jaro-Winkler adds a bonus for strings that share a common prefix (up to 4
 * chars), which suits person names better than plain Jaro/Levenshtein.
 */
export function jaroWinklerSimilarity(a: string, b: string, scalingFactor = 0.1): number {
  const jaro = jaroSimilarity(a, b);
  const maxPrefix = 4;
  let prefixLength = 0;
  for (let i = 0; i < Math.min(maxPrefix, a.length, b.length); i++) {
    if (a[i] !== b[i]) break;
    prefixLength++;
  }
  return jaro + prefixLength * scalingFactor * (1 - jaro);
}
