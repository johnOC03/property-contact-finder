import { addressSimilarityScore } from './address-similarity';

describe('addressSimilarityScore', () => {
  it('returns 0 when either address is missing', () => {
    expect(addressSimilarityScore(undefined, '12 Queen St, Auckland')).toBe(0);
    expect(addressSimilarityScore('12 Queen St, Auckland', undefined)).toBe(0);
  });

  it('gives full marks for a matching street number + overlapping words', () => {
    const score = addressSimilarityScore(
      '12 Queen Street, Auckland',
      '12 Queen St, Auckland Central',
    );
    expect(score).toBe(40);
  });

  it('gives partial credit for a street number match with little else in common', () => {
    const score = addressSimilarityScore(
      '12 Queen Street, Auckland',
      '12 Some Other Road, Wellington',
    );
    expect(score).toBe(28);
  });

  it('gives low/no credit when nothing meaningful overlaps', () => {
    const score = addressSimilarityScore('12 Queen Street, Auckland', '99 Totally Different Road');
    expect(score).toBe(0);
  });
});
