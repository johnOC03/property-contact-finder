import { dedupeContactDetails, RawContactDetail } from './contact-detail-dedupe';

function raw(overrides: Partial<RawContactDetail> & Pick<RawContactDetail, 'type' | 'value'>): RawContactDetail {
  return { sourceType: 'WEB_SEARCH', ...overrides };
}

describe('dedupeContactDetails', () => {
  it('merges identical phone numbers reported by different sources into one entry with both sources', () => {
    const details: RawContactDetail[] = [
      raw({ type: 'phone', value: '09 415 4477', sourceUrl: 'https://a.example.com' }),
      raw({ type: 'phone', value: '09 415 4477', sourceUrl: 'https://b.example.com' }),
    ];

    const result = dedupeContactDetails(details);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('09 415 4477');
    expect(result[0].sources).toEqual([
      { sourceUrl: 'https://a.example.com', sourceType: 'WEB_SEARCH' },
      { sourceUrl: 'https://b.example.com', sourceType: 'WEB_SEARCH' },
    ]);
  });

  it('normalizes phone formatting/country-code differences to the same entry', () => {
    const details: RawContactDetail[] = [
      raw({ type: 'phone', value: '09 415 4477', sourceUrl: 'https://a.example.com' }),
      raw({ type: 'phone', value: '+64 9 415 4477', sourceUrl: 'https://b.example.com' }),
      raw({ type: 'phone', value: '(09) 415-4477', sourceUrl: 'https://c.example.com' }),
    ];

    const result = dedupeContactDetails(details);

    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(3);
  });

  it('keeps distinct phone numbers as separate entries', () => {
    const details: RawContactDetail[] = [
      raw({ type: 'phone', value: '09 415 4477' }),
      raw({ type: 'phone', value: '+64 9 377 9966' }),
    ];

    const result = dedupeContactDetails(details);

    expect(result).toHaveLength(2);
  });

  it('merges a redacted email with its unredacted counterpart from the same domain, preferring the full value', () => {
    const details: RawContactDetail[] = [
      raw({ type: 'email', value: 'bcullen@example.co.nz', sourceUrl: 'https://a.example.com' }),
      raw({ type: 'email', value: 'b***@example.co.nz', sourceUrl: 'https://b.example.com' }),
    ];

    const result = dedupeContactDetails(details);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('bcullen@example.co.nz');
    expect(result[0].sources).toHaveLength(2);
  });

  it('merges addresses that differ only by a trailing suburb/city suffix', () => {
    const details: RawContactDetail[] = [
      raw({ type: 'address', value: '5-7 Corinthian Drive, Albany', sourceUrl: 'https://a.example.com' }),
      raw({ type: 'address', value: '5-7 Corinthian Drive, Albany, Auckland', sourceUrl: 'https://b.example.com' }),
    ];

    const result = dedupeContactDetails(details);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('5-7 Corinthian Drive, Albany, Auckland');
    expect(result[0].sources).toHaveLength(2);
  });

  it('deduplicates identical source URLs so the same link is not listed twice', () => {
    const details: RawContactDetail[] = [
      raw({ type: 'phone', value: '09 415 4477', sourceUrl: 'https://a.example.com/' }),
      raw({ type: 'phone', value: '09 415 4477', sourceUrl: 'https://a.example.com' }),
    ];

    const result = dedupeContactDetails(details);

    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(1);
  });

  it('keeps unrelated "other" free-text notes as separate entries', () => {
    const details: RawContactDetail[] = [
      raw({ type: 'other', value: 'Mobile (not listed)' }),
      raw({ type: 'other', value: '09 415 4477 (DDI)' }),
    ];

    const result = dedupeContactDetails(details);

    expect(result).toHaveLength(2);
  });

  it('returns entries grouped in phone, email, other, address order', () => {
    const details: RawContactDetail[] = [
      raw({ type: 'address', value: '1 Queen St' }),
      raw({ type: 'other', value: 'Mobile' }),
      raw({ type: 'email', value: 'a@example.com' }),
      raw({ type: 'phone', value: '09 111 1111' }),
    ];

    const result = dedupeContactDetails(details);

    expect(result.map((d) => d.type)).toEqual(['phone', 'email', 'other', 'address']);
  });
});
