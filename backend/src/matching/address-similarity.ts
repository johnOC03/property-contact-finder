const ADDRESS_STOPWORDS = new Set([
  'street',
  'st',
  'road',
  'rd',
  'avenue',
  'ave',
  'place',
  'pl',
  'drive',
  'dr',
  'lane',
  'ln',
  'court',
  'ct',
  'terrace',
  'tce',
  'way',
  'crescent',
  'cres',
  'unit',
  'suite',
  'flat',
  'level',
]);

function tokenizeAddress(address: string): string[] {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Approximate address similarity, weighted 0-40 points per
 * IMPLEMENTATION_PLAN.md section 6.
 *
 * Shortcut: this compares raw-text tokens rather than Google Places'
 * structured components (street_number/route/suburb/postcode) as the plan
 * describes, because Google Places Autocomplete isn't wired up yet
 * (GOOGLE_PLACES_API_KEY is unset). Revisit once that's integrated — a
 * structured comparison will be materially more reliable than token overlap.
 */
export function addressSimilarityScore(
  inputAddress: string | undefined,
  candidateAddress: string | undefined,
): number {
  if (!inputAddress || !candidateAddress) return 0;

  const inputTokens = tokenizeAddress(inputAddress);
  const candidateTokens = new Set(tokenizeAddress(candidateAddress));
  if (inputTokens.length === 0 || candidateTokens.size === 0) return 0;

  const inputNumber = inputTokens.find((token) => /^\d+[a-z]?$/.test(token));
  const streetNumberMatches = inputNumber ? candidateTokens.has(inputNumber) : false;

  const meaningfulInputTokens = inputTokens.filter((token) => !ADDRESS_STOPWORDS.has(token));
  const overlap = meaningfulInputTokens.filter((token) => candidateTokens.has(token));
  const overlapRatio =
    meaningfulInputTokens.length > 0 ? overlap.length / meaningfulInputTokens.length : 0;

  // Street number + word overlap is the strongest signal (likely same building).
  if (streetNumberMatches && overlapRatio >= 0.5) return 40;
  if (streetNumberMatches) return 28;
  if (overlapRatio >= 0.6) return 20;
  if (overlapRatio > 0) return 10;
  return 0;
}
