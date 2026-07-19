import { nameSimilarityScore, normalizeName } from './name-similarity';

describe('normalizeName', () => {
  it('lower-cases and strips titles and middle initials', () => {
    expect(normalizeName('Mr John A. Smith')).toBe('john smith');
  });

  it('strips punctuation', () => {
    expect(normalizeName("O'Brien-Smith")).toBe("o'brien-smith");
  });
});

describe('nameSimilarityScore', () => {
  it('gives full 40 points for an exact match', () => {
    expect(nameSimilarityScore('John Smith', 'John Smith')).toBe(40);
  });

  it('gives high score for a title/initial variant of the same name', () => {
    const score = nameSimilarityScore('John Smith', 'Mr John A. Smith');
    expect(score).toBeGreaterThanOrEqual(36);
  });

  it('gives a low score for a different name', () => {
    const score = nameSimilarityScore('John Smith', 'Zephyr Okonkwo');
    expect(score).toBeLessThan(15);
  });

  it('returns 0 when a name is empty after normalization', () => {
    expect(nameSimilarityScore('Mr', 'John Smith')).toBe(0);
  });
});
