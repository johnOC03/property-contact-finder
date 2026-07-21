export type ContactDetailType = 'email' | 'phone' | 'other' | 'address';
export type ContactDetailSourceType = 'YELLOW_PAGES' | 'WEB_SEARCH';

/** One contact detail exactly as reported by a single matching AI web
 * search lead, before deduplication — the same real-world fact (e.g. one
 * phone number) typically appears once per corroborating lead, since the
 * search ensemble runs the same query several times against several
 * sources. */
export interface RawContactDetail {
  type: ContactDetailType;
  value: string;
  sourceUrl?: string;
  sourceType: ContactDetailSourceType;
}

export interface ContactDetailSource {
  sourceUrl?: string;
  sourceType: ContactDetailSourceType;
}

/** A single displayed contact detail, after grouping every equivalent raw
 * detail (same phone/email/address, possibly formatted differently by
 * different sources) into one entry with every distinct supporting source
 * retained underneath it. */
export interface ContactDetail {
  type: ContactDetailType;
  value: string;
  sources: ContactDetailSource[];
}

/** Digits-only phone key, stripping the trunk "0" prefix or "64" country
 * code, so "09 415 4477", "(09) 415-4477" and "+64 9 415 4477" all
 * normalize to the same key regardless of formatting/country-code style. */
function normalizePhoneKey(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('64')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
}

function normalizeEmailKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOtherKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

function addressTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

/** Two addresses are treated as the same place when nearly all of the
 * shorter one's tokens appear in the longer one — handles a source adding
 * (or omitting) a trailing suburb/city, e.g. "5-7 Corinthian Drive, Albany"
 * vs "5-7 Corinthian Drive, Albany, Auckland". */
function addressesMatch(a: string, b: string): boolean {
  const tokensA = addressTokens(a);
  const tokensB = addressTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  const [smaller, larger] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  const overlap = [...smaller].filter((token) => larger.has(token)).length;
  return overlap / smaller.size >= 0.8;
}

/** A redacted email (e.g. "b***@example.com") is treated as the same email
 * as an unredacted one from the same domain whose local part starts with
 * the redacted value's visible prefix. */
function isRedactedVariantOf(redacted: string, full: string): boolean {
  const [redactedLocal, redactedDomain] = redacted.toLowerCase().split('@');
  const [fullLocal, fullDomain] = full.toLowerCase().split('@');
  if (!redactedLocal || !redactedDomain || !fullLocal || !fullDomain) return false;
  if (redactedDomain !== fullDomain) return false;
  if (!redactedLocal.includes('*')) return false;
  const visiblePrefix = redactedLocal.split('*')[0];
  return visiblePrefix.length > 0 && fullLocal.startsWith(visiblePrefix);
}

function valuesAreEquivalent(type: ContactDetailType, a: string, b: string): boolean {
  switch (type) {
    case 'phone':
      return normalizePhoneKey(a) === normalizePhoneKey(b);
    case 'email':
      return normalizeEmailKey(a) === normalizeEmailKey(b) || isRedactedVariantOf(a, b) || isRedactedVariantOf(b, a);
    case 'address':
      return addressesMatch(a, b);
    case 'other':
    default:
      return normalizeOtherKey(a) === normalizeOtherKey(b);
  }
}

/** Prefers a non-redacted value and, among those, the longest/most complete
 * string, as the representative value shown for a group of equivalent
 * details. */
function pickRepresentativeValue(values: string[]): string {
  const unredacted = values.filter((value) => !value.includes('*'));
  const pool = unredacted.length > 0 ? unredacted : values;
  return pool.reduce((best, current) => (current.length > best.length ? current : best));
}

function sourceKey(source: ContactDetailSource): string {
  return source.sourceUrl ? `url:${source.sourceUrl.trim().toLowerCase().replace(/\/+$/, '')}` : `type:${source.sourceType}`;
}

function dedupeSources(sources: ContactDetailSource[]): ContactDetailSource[] {
  const seen = new Map<string, ContactDetailSource>();
  for (const source of sources) {
    const key = sourceKey(source);
    if (!seen.has(key)) {
      seen.set(key, source);
    }
  }
  return [...seen.values()];
}

interface Cluster {
  values: string[];
  sources: ContactDetailSource[];
}

/**
 * Groups raw contact details — one per matching AI web-search lead, so the
 * same real-world fact commonly appears once per corroborating source — into
 * a single displayed entry per unique phone number / email / address / other
 * note. Normalizes formatting differences (phone punctuation/country code,
 * redacted emails, suburb/city suffixes on addresses) before comparing, and
 * retains every distinct source link under the merged entry instead of
 * repeating the same detail once per source.
 */
export function dedupeContactDetails(details: RawContactDetail[]): ContactDetail[] {
  const types: ContactDetailType[] = ['phone', 'email', 'other', 'address'];
  const result: ContactDetail[] = [];

  for (const type of types) {
    const clusters: Cluster[] = [];
    for (const detail of details.filter((d) => d.type === type)) {
      const source: ContactDetailSource = { sourceUrl: detail.sourceUrl, sourceType: detail.sourceType };
      const cluster = clusters.find((c) => c.values.some((existing) => valuesAreEquivalent(type, existing, detail.value)));
      if (cluster) {
        cluster.values.push(detail.value);
        cluster.sources.push(source);
      } else {
        clusters.push({ values: [detail.value], sources: [source] });
      }
    }

    for (const cluster of clusters) {
      result.push({
        type,
        value: pickRepresentativeValue(cluster.values),
        sources: dedupeSources(cluster.sources),
      });
    }
  }

  return result;
}
