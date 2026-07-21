import { leadCorroboratesCandidate, namesCorroborate, hasCorroboratingAddressSignal } from './lead-matching';
import type { ContactLead } from '../ai/open-router.service';

describe('namesCorroborate', () => {
  it('matches identical names', () => {
    expect(namesCorroborate('Allison Dymond', 'Allison Dymond')).toBe(true);
  });

  it('matches when the surname is exact and the first name is a close spelling variant', () => {
    expect(namesCorroborate('Alison Dymond', 'Allison Dymond')).toBe(true);
  });

  it('ignores an extra middle name', () => {
    expect(namesCorroborate('Alison May Dymond', 'Allison Dymond')).toBe(true);
  });

  it('rejects a different surname even if the first name matches exactly', () => {
    expect(namesCorroborate('Allison Smith', 'Allison Dymond')).toBe(false);
  });

  it('rejects a first name that is too different despite a matching surname', () => {
    expect(namesCorroborate('Michael Dymond', 'Allison Dymond')).toBe(false);
  });
});

describe('hasCorroboratingAddressSignal', () => {
  const baseLead: ContactLead = { name: 'Allison Dymond' };

  it('returns false when the lead has no other/quote text', () => {
    expect(hasCorroboratingAddressSignal(baseLead, ['1 Shea Terrace, Takapuna, Auckland'])).toBe(false);
  });

  it('returns false when no known addresses are provided', () => {
    const lead: ContactLead = { ...baseLead, other: '1 Shea Terrace, Takapuna, Auckland 0622' };
    expect(hasCorroboratingAddressSignal(lead, [])).toBe(false);
  });

  it('returns true when the lead text contains a known address', () => {
    const lead: ContactLead = {
      ...baseLead,
      other: 'Director at Schnauer and Co Limited, 1 Shea Terrace, Takapuna, Auckland 0622, New Zealand',
    };
    expect(hasCorroboratingAddressSignal(lead, ['1 Shea Terrace, Takapuna, Auckland'])).toBe(true);
  });

  it('returns false when the lead text address does not overlap with any known address', () => {
    const lead: ContactLead = { ...baseLead, other: '5 Different Road, Wellington' };
    expect(hasCorroboratingAddressSignal(lead, ['1 Shea Terrace, Takapuna, Auckland'])).toBe(false);
  });

  it('returns true when the explicit address field matches a known address, with no other/quote text', () => {
    const lead: ContactLead = { ...baseLead, address: '1 Shea Terrace, Takapuna, Auckland 0622' };
    expect(hasCorroboratingAddressSignal(lead, ['1 Shea Terrace, Takapuna, Auckland'])).toBe(true);
  });

  it('returns false when the explicit address field does not overlap with any known address', () => {
    const lead: ContactLead = { ...baseLead, address: '5 Different Road, Wellington' };
    expect(hasCorroboratingAddressSignal(lead, ['1 Shea Terrace, Takapuna, Auckland'])).toBe(false);
  });
});

describe('leadCorroboratesCandidate', () => {
  it('requires both a name match and an address signal', () => {
    const lead: ContactLead = {
      name: 'Alison May Dymond',
      other: 'Director at Schnauer and Co Limited, 1 Shea Terrace, Takapuna, Auckland 0622, New Zealand',
    };
    expect(leadCorroboratesCandidate(lead, 'Allison Dymond', ['1 Shea Terrace, Takapuna, Auckland'])).toBe(true);
  });

  it('rejects a fuzzy name match with no corroborating address', () => {
    const lead: ContactLead = { name: 'Alison May Dymond', quote: 'no address mentioned here' };
    expect(leadCorroboratesCandidate(lead, 'Allison Dymond', ['1 Shea Terrace, Takapuna, Auckland'])).toBe(false);
  });

  it('rejects a matching address with no corroborating name', () => {
    const lead: ContactLead = {
      name: 'Someone Else',
      other: '1 Shea Terrace, Takapuna, Auckland 0622, New Zealand',
    };
    expect(leadCorroboratesCandidate(lead, 'Allison Dymond', ['1 Shea Terrace, Takapuna, Auckland'])).toBe(false);
  });

  it('rejects a lead with no name at all', () => {
    const lead: ContactLead = { other: '1 Shea Terrace, Takapuna, Auckland 0622, New Zealand' };
    expect(leadCorroboratesCandidate(lead, 'Allison Dymond', ['1 Shea Terrace, Takapuna, Auckland'])).toBe(false);
  });
});
