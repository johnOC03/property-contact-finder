import { Test, TestingModule } from '@nestjs/testing';
import { MatchingService } from './matching.service';

describe('MatchingService', () => {
  let service: MatchingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MatchingService],
    }).compile();

    service = module.get<MatchingService>(MatchingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('labels an exact name + address match as High confidence', () => {
    const result = service.score(
      { ownerName: 'John Smith', address: '12 Queen St, Auckland' },
      { matchedName: 'John Smith', address: '12 Queen Street, Auckland', status: 'active' },
    );
    expect(result.label).toBe('High');
    expect(result.score).toBe(80);
  });

  it('labels a name-only match (no address provided) as Low confidence', () => {
    const result = service.score(
      { ownerName: 'John Smith' },
      { matchedName: 'John Smith', address: '12 Queen Street, Auckland', status: 'active' },
    );
    expect(result.label).toBe('Low');
    expect(result.score).toBe(40);
  });

  it('labels an unrelated namesake whose address does not match as Low, not filtered', () => {
    // This is the exact "John Smith in Florida" scenario a common name can
    // surface: the name matches but the address flags it as unlikely to be
    // the same person, so it's still shown (Low) with an explanatory
    // rationale rather than silently disappearing.
    const result = service.score(
      { ownerName: 'John Smith', address: '12 Queen St, Auckland' },
      {
        matchedName: 'John Smith',
        address: '3956 Town Centre Boulevard, Orlando, Florida, USA',
        status: 'active',
      },
    );
    expect(result.label).toBe('Low');
    expect(result.score).toBe(40);
    expect(result.rationale).toContain('does not match');
  });

  it('filters out a genuinely unrelated name with no address to corroborate', () => {
    const result = service.score(
      { ownerName: 'John Smith' },
      { matchedName: 'Zephyr Okonkwo', status: 'active' },
    );
    expect(result.label).toBeNull();
    expect(result.score).toBeLessThan(20);
  });

  it('uses the best-scoring additionalAddress (e.g. NZBN registered address) when the role address does not match', () => {
    const result = service.score(
      { ownerName: 'John Smith', address: '9/14 Ruakura Road, Hamilton East' },
      {
        matchedName: 'John Smith',
        address: '14 Perotti Place, Conifer Grove, Takanini',
        additionalAddresses: ['9/14 Ruakura Road, Hamilton East, Hamilton'],
        status: 'active',
      },
    );
    expect(result.label).toBe('High');
    expect(result.rationale).toContain('9/14 Ruakura Road, Hamilton East, Hamilton');
  });

  it('applies a status discount when the NZBN company status is not active', () => {
    const result = service.score(
      { ownerName: 'John Smith' },
      { matchedName: 'John Smith', status: 'active', companyStatus: 'Removed' },
    );
    expect(result.score).toBe(30); // 40 name score - 10 status discount
    expect(result.rationale).toContain('company status "Removed" is not active');
  });

  it('applies a status discount for an inactive/ceased role', () => {
    const active = service.score(
      { ownerName: 'John Smith' },
      { matchedName: 'John Smith', status: 'active' },
    );
    const ceased = service.score(
      { ownerName: 'John Smith' },
      { matchedName: 'John Smith', status: 'ceased' },
    );
    expect(ceased.score).toBe(active.score - 10);
  });

  it('adds a corroboration bonus when an independent AI web search lead matches the same name', () => {
    const result = service.score(
      { ownerName: 'John Smith' },
      { matchedName: 'John Smith', status: 'active', hasCorroboratingWebLead: true },
    );
    expect(result.score).toBe(60); // 40 name score + 20 corroboration bonus
    expect(result.label).toBe('Medium');
    expect(result.rationale).toContain('corroborated by a public web/Yellow Pages contact listing');
  });

  it('never leaves the rationale referencing an undefined address when every known address scores 0', () => {
    // Regression test: `bestAddress` used to stay undefined whenever every
    // candidate address tied at a score of 0, producing the literal string
    // "known address (undefined) does not match" in the rationale.
    const result = service.score(
      { ownerName: 'John Smith', address: '1 Totally Different Street, Wellington' },
      {
        matchedName: 'John Smith',
        address: '75 Jones Deviation, Porirua',
        additionalAddresses: ['3 Milkers Gate, Parklands, Christchurch'],
        status: 'active',
      },
    );
    expect(result.rationale).not.toContain('undefined');
    expect(result.rationale).toContain('does not match');
  });
});
