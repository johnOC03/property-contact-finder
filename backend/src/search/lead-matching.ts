import { jaroWinklerSimilarity } from '../matching/jaro-winkler';
import { normalizeName } from '../matching/name-similarity';
import { addressSimilarityScore } from '../matching/address-similarity';
import type { ContactLead } from '../ai/open-router.service';

/** Minor spelling variants (e.g. "Alison" vs "Allison") are close enough. */
const FIRST_NAME_SIMILARITY_THRESHOLD = 0.85;

/** Requires more than a single coincidental shared word (see address-similarity.ts scoring bands). */
const CORROBORATING_ADDRESS_SCORE_THRESHOLD = 20;

/**
 * A lead's name "corroborates" a candidate's name when the surname matches
 * exactly and the first name matches closely — allowing minor spelling
 * variants (AI web search results are not always spelled identically to
 * MBIE records) — while ignoring any middle names/initials on either side.
 *
 * This is deliberately looser than an exact string match (which would miss
 * real hits like "Alison May Dymond" vs. "Allison Dymond") but still
 * requires the surname to line up exactly, since first-name-only matches
 * are too common to trust alone.
 */
export function namesCorroborate(leadName: string, candidateName: string): boolean {
  const leadTokens = normalizeName(leadName).split(' ').filter(Boolean);
  const candidateTokens = normalizeName(candidateName).split(' ').filter(Boolean);
  if (leadTokens.length === 0 || candidateTokens.length === 0) return false;

  const leadSurname = leadTokens[leadTokens.length - 1];
  const candidateSurname = candidateTokens[candidateTokens.length - 1];
  if (leadSurname !== candidateSurname) return false;

  const leadFirst = leadTokens[0];
  const candidateFirst = candidateTokens[0];
  if (leadFirst === candidateFirst) return true;

  return jaroWinklerSimilarity(leadFirst, candidateFirst) >= FIRST_NAME_SIMILARITY_THRESHOLD;
}

/**
 * Checks whether a lead's own free text (its `other`/`quote` fields, which
 * often contain an address the AI found alongside the contact detail) lines
 * up with any address we already know for this search/candidate. This is
 * the "at least one other signal" requirement — a name match alone (even a
 * fuzzy one) is never enough to treat an AI web search lead as corroborating.
 */
export function hasCorroboratingAddressSignal(
  lead: ContactLead,
  knownAddresses: Array<string | undefined>,
): boolean {
  const leadText = [lead.other, lead.quote].filter(Boolean).join(' ');
  if (!leadText) return false;

  return knownAddresses
    .filter((address): address is string => !!address)
    .some((address) => addressSimilarityScore(address, leadText) >= CORROBORATING_ADDRESS_SCORE_THRESHOLD);
}

/**
 * A lead only corroborates a candidate when BOTH the fuzzy name check and at
 * least one other independent signal (currently: address) agree — a fuzzy
 * name match by itself is too weak to trust given how common first+last
 * name combinations are.
 */
export function leadCorroboratesCandidate(
  lead: ContactLead,
  candidateName: string,
  knownAddresses: Array<string | undefined>,
): boolean {
  if (!lead.name || !namesCorroborate(lead.name, candidateName)) return false;
  return hasCorroboratingAddressSignal(lead, knownAddresses);
}
