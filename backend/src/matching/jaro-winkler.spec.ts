import { jaroWinklerSimilarity } from './jaro-winkler';

describe('jaroWinklerSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(jaroWinklerSimilarity('john smith', 'john smith')).toBe(1);
  });

  it('returns 0 when either string is empty', () => {
    expect(jaroWinklerSimilarity('', 'john')).toBe(0);
    expect(jaroWinklerSimilarity('john', '')).toBe(0);
  });

  it('scores close variants highly', () => {
    const score = jaroWinklerSimilarity('john smith', 'jon smith');
    expect(score).toBeGreaterThan(0.9);
  });

  it('scores unrelated names low', () => {
    const score = jaroWinklerSimilarity('john smith', 'zephyr okonkwo');
    expect(score).toBeLessThan(0.5);
  });

  it('rewards a shared prefix over a shared suffix', () => {
    const sharedPrefix = jaroWinklerSimilarity('martha', 'marhta');
    const sharedSuffix = jaroWinklerSimilarity('artham', 'arhtam');
    expect(sharedPrefix).toBeGreaterThan(sharedSuffix);
  });
});
