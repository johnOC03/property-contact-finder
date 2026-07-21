import { Injectable, Logger } from '@nestjs/common';
import { SearchStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EntityRoleClientService } from '../mbie/entity-role-client.service';
import { formatNzbnAddress, NzbnClientService, NzbnEntityDetail } from '../mbie/nzbn-client.service';
import { ContactLead, OpenRouterService } from '../ai/open-router.service';
import { ConfidenceLabel, MatchingService } from '../matching/matching.service';
import { addressSimilarityScore } from '../matching/address-similarity';
import { normalizeName } from '../matching/name-similarity';
import { hasCorroboratingAddressSignal, leadCorroboratesCandidate, namesCorroborate } from './lead-matching';
import { ContactDetail, dedupeContactDetails, RawContactDetail } from './contact-detail-dedupe';
import { SearchRequestDto } from './dto/search-request.dto';

export type { ContactDetail } from './contact-detail-dedupe';

const YELLOW_OR_WHITE_PAGES_HOSTS = ['yellow.co.nz', 'whitepages.co.nz'];

/** Caps a candidate discovered only via AI web search (no MBIE record at
 * all) to Low confidence — unlike an MBIE-only match, it has no
 * government-register backing, so it's never allowed to reach Medium/High
 * on its own, however strong the name/address match looks. */
const AI_ONLY_MAX_SCORE = 49;

export interface SearchCandidate {
  matchedName: string;
  /** Absent for candidates discovered only via AI web search (no MBIE role at all). */
  roleType?: string;
  status?: string;
  companyName?: string;
  companyNzbn?: string;
  address?: string;
  /** NZBN registered office address, when the company's NZBN detail was
   * successfully fetched — a more authoritative address than the role's own
   * physical address for comparing against the searched property address. */
  registeredAddress?: string;
  /** NZBN entityStatusDescription (e.g. "Registered" vs "Removed"). */
  companyStatus?: string;
  /** Public contact details surfaced by AI web search (OpenRouter/Sonar)
   * under this candidate's same name — a corroborating, independent source. */
  contactDetails?: ContactDetail[];
  sourceType: 'MBIE_ENTITY_ROLE' | 'AI_WEB_SEARCH' | 'AI_PROPERTY_CONNECTION';
  confidenceScore: number;
  /** null means the score fell below the "shown" threshold (< 20). */
  confidenceLabel: ConfidenceLabel | null;
  rationale: string;
}

export interface SearchResponse {
  candidates: SearchCandidate[];
  /** Populated only when nothing clears the "shown" threshold, so the user
   * still sees the best available leads instead of a bare empty state. */
  otherPossibleMatches: SearchCandidate[];
  warnings: string[];
}

/** Summary of a past search, for a "recent searches" list. */
export interface SearchHistoryItem {
  id: string;
  ownerName: string;
  propertyAddress: string | null;
  status: SearchStatus;
  createdAt: Date;
}

/** A past search's full stored result, so it can be viewed without
 * re-calling MBIE/OpenRouter. */
export interface SearchHistoryDetail extends SearchHistoryItem {
  result: SearchResponse | null;
  errorMessage: string | null;
}

const MAX_OTHER_MATCHES = 5;
const MAX_HISTORY_LIMIT = 100;
const DEFAULT_HISTORY_LIMIT = 20;

type RawCandidate = Omit<
  SearchCandidate,
  'confidenceScore' | 'confidenceLabel' | 'rationale' | 'registeredAddress' | 'companyStatus' | 'contactDetails'
>;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly entityRoleClient: EntityRoleClientService,
    private readonly nzbnClient: NzbnClientService,
    private readonly openRouterService: OpenRouterService,
    private readonly matchingService: MatchingService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Persists a `SearchRequest` record for the lifetime of the search —
   * created as PENDING before any external calls are made, then updated to
   * COMPLETED (with the full result/warnings JSON) or FAILED (with the error
   * message) once it's done, so past searches can be reviewed/audited later.
   */
  async search(dto: SearchRequestDto): Promise<SearchResponse> {
    const searchRequest = await this.prisma.searchRequest.create({
      data: { ownerName: dto.ownerName, propertyAddress: dto.address },
    });

    try {
      const result = await this.runSearch(dto);
      await this.prisma.searchRequest.update({
        where: { id: searchRequest.id },
        data: {
          status: SearchStatus.COMPLETED,
          resultJson: JSON.parse(
            JSON.stringify({ candidates: result.candidates, otherPossibleMatches: result.otherPossibleMatches }),
          ),
          warningsJson: JSON.parse(JSON.stringify(result.warnings)),
        },
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Search ${searchRequest.id} failed: ${message}`);
      await this.prisma.searchRequest.update({
        where: { id: searchRequest.id },
        data: { status: SearchStatus.FAILED, errorMessage: message },
      });
      throw error;
    }
  }

  /** Lists past searches, most recent first, so the user can pick one to
   * view or re-run instead of retyping the name/address. */
  async listHistory(limit = DEFAULT_HISTORY_LIMIT): Promise<SearchHistoryItem[]> {
    const take = Math.min(Math.max(limit, 1), MAX_HISTORY_LIMIT);
    const rows = await this.prisma.searchRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, ownerName: true, propertyAddress: true, status: true, createdAt: true },
    });
    return rows;
  }

  /** Fetches a single past search's stored result, reassembling it back
   * into a `SearchResponse` shape from the split `resultJson`/`warningsJson`
   * columns. Returns null if no search with that id exists. */
  async getHistoryDetail(id: string): Promise<SearchHistoryDetail | null> {
    const row = await this.prisma.searchRequest.findUnique({ where: { id } });
    if (!row) return null;

    const resultJson = row.resultJson as { candidates: SearchCandidate[]; otherPossibleMatches: SearchCandidate[] } | null;
    const warnings = (row.warningsJson as string[] | null) ?? [];

    return {
      id: row.id,
      ownerName: row.ownerName,
      propertyAddress: row.propertyAddress,
      status: row.status,
      createdAt: row.createdAt,
      errorMessage: row.errorMessage,
      result: resultJson
        ? { candidates: resultJson.candidates, otherPossibleMatches: resultJson.otherPossibleMatches, warnings }
        : null,
    };
  }

  private async runSearch(dto: SearchRequestDto): Promise<SearchResponse> {
    const warnings: string[] = [];

    // Entity/Role Search and the AI web search are independent sources that
    // don't depend on each other, so they fire in parallel (see
    // IMPLEMENTATION_PLAN.md section 5). `Promise.allSettled` (not `all`)
    // means a failure in either one only adds a warning — it never discards
    // results that already succeeded from the other source.
    const [roleResult, webResult] = await Promise.allSettled([
      this.entityRoleClient.searchPersonRoles(dto.ownerName),
      this.openRouterService.searchContactDetailsEnsemble(dto.ownerName, dto.address),
    ]);

    let rawCandidates: RawCandidate[] = [];
    if (roleResult.status === 'fulfilled') {
      rawCandidates = (roleResult.value.roles ?? []).map((role) => ({
        matchedName: `${role.firstName} ${role.lastName}`.trim(),
        roleType: role.roleType,
        status: role.status,
        companyName: role.associatedCompanyName,
        companyNzbn: role.associatedCompanyNzbn,
        address: role.physicalAddress?.addressLines?.join(', '),
        sourceType: 'MBIE_ENTITY_ROLE' as const,
      }));
    } else {
      const message = roleResult.reason instanceof Error ? roleResult.reason.message : 'Unknown error';
      this.logger.warn(`MBIE Entity/Role Search unavailable: ${message}`);
      warnings.push('MBIE Entity/Role Search unavailable');
    }

    let contactLeads: ContactLead[] = [];
    if (webResult.status === 'fulfilled') {
      contactLeads = webResult.value;
    } else {
      const message = webResult.reason instanceof Error ? webResult.reason.message : 'Unknown error';
      this.logger.warn(`AI web search unavailable: ${message}`);
      warnings.push('AI web search unavailable');
    }

    const nzbnDetailByNzbn = await this.fetchNzbnDetails(rawCandidates, warnings);

    // Tracks which AI web search leads corroborated at least one MBIE
    // candidate, so leftover leads (found by AI web search alone, with no
    // matching MBIE record at all) can still be surfaced below instead of
    // silently discarded — MBIE/NZBN are not the only way to discover a
    // possible owner.
    const claimedLeads = new Set<ContactLead>();

    const mbieScored: SearchCandidate[] = rawCandidates
      .map((candidate) => {
        const nzbnDetail = candidate.companyNzbn ? nzbnDetailByNzbn.get(candidate.companyNzbn) : undefined;
        const registeredAddress = nzbnDetail && this.findRegisteredAddress(nzbnDetail);
        const additionalAddresses = nzbnDetail
          ? (nzbnDetail.addresses?.addressList ?? [])
              .map(formatNzbnAddress)
              .filter((address): address is string => !!address)
          : [];
        const companyStatus = nzbnDetail?.entityStatusDescription;

        const knownAddresses = [dto.address, candidate.address, registeredAddress, ...additionalAddresses];
        const matchingLeads = contactLeads.filter((lead) =>
          leadCorroboratesCandidate(lead, candidate.matchedName, knownAddresses),
        );
        matchingLeads.forEach((lead) => claimedLeads.add(lead));
        const contactDetails = this.buildContactDetails(matchingLeads);
        const hasCorroboratingWebLead = matchingLeads.length > 0;

        const match = this.matchingService.score(
          { ownerName: dto.ownerName, address: dto.address },
          { ...candidate, additionalAddresses, companyStatus, hasCorroboratingWebLead },
        );
        return {
          ...candidate,
          registeredAddress,
          companyStatus,
          contactDetails: contactDetails.length > 0 ? contactDetails : undefined,
          confidenceScore: match.score,
          confidenceLabel: match.label,
          rationale: match.rationale,
        };
      });

    const webOnlyCandidates = this.buildWebOnlyCandidates(dto, contactLeads, claimedLeads);
    const propertyConnectionCandidates = this.buildPropertyConnectionCandidates(dto, contactLeads, claimedLeads);

    const scored = [...mbieScored, ...webOnlyCandidates, ...propertyConnectionCandidates].sort(
      (a, b) => b.confidenceScore - a.confidenceScore,
    );

    const candidates = scored.filter((candidate) => candidate.confidenceLabel !== null);
    const otherPossibleMatches = candidates.length === 0 ? scored.slice(0, MAX_OTHER_MATCHES) : [];

    return { candidates, otherPossibleMatches, warnings };
  }

  /**
   * Converts matched AI web search leads into displayable contact details,
   * tagging each as YELLOW_PAGES when the source URL is from a known
   * Yellow/White Pages host, or WEB_SEARCH otherwise, then runs the result
   * through `dedupeContactDetails` so the same phone/email/address found by
   * several corroborating leads (the AI search ensemble runs several times,
   * often against different sources) is shown once with every distinct
   * source retained, instead of repeating once per source.
   */
  private buildContactDetails(leads: ContactLead[]): ContactDetail[] {
    const details: RawContactDetail[] = [];
    for (const lead of leads) {
      const sourceType: RawContactDetail['sourceType'] =
        lead.sourceUrl && YELLOW_OR_WHITE_PAGES_HOSTS.some((host) => lead.sourceUrl?.includes(host))
          ? 'YELLOW_PAGES'
          : 'WEB_SEARCH';
      if (lead.phone) {
        details.push({ type: 'phone', value: lead.phone, sourceUrl: lead.sourceUrl, sourceType });
      }
      if (lead.email) {
        details.push({ type: 'email', value: lead.email, sourceUrl: lead.sourceUrl, sourceType });
      }
      if (lead.other) {
        details.push({ type: 'other', value: lead.other, sourceUrl: lead.sourceUrl, sourceType });
      }
      if (lead.address) {
        details.push({ type: 'address', value: lead.address, sourceUrl: lead.sourceUrl, sourceType });
      }
    }
    return dedupeContactDetails(details);
  }

  /**
   * Builds a single candidate from AI web search leads that didn't
   * corroborate any MBIE candidate — i.e. a person the AI search found
   * under a closely-matching name, with no MBIE/NZBN record at all. MBIE
   * is not treated as the only way to discover a possible owner, but since
   * this candidate rests entirely on unverified free text (no
   * government-register backing), its score is capped well below what an
   * MBIE-only match could reach (see AI_ONLY_MAX_SCORE).
   */
  private buildWebOnlyCandidates(
    dto: SearchRequestDto,
    contactLeads: ContactLead[],
    claimedLeads: Set<ContactLead>,
  ): SearchCandidate[] {
    const unclaimedLeads = contactLeads.filter(
      (lead) => !claimedLeads.has(lead) && lead.name && namesCorroborate(lead.name, dto.ownerName),
    );
    if (unclaimedLeads.length === 0) {
      return [];
    }

    const additionalAddresses = unclaimedLeads
      .map((lead) => lead.address)
      .filter((address): address is string => !!address);
    const contactDetails = this.buildContactDetails(unclaimedLeads);

    const match = this.matchingService.score(
      { ownerName: dto.ownerName, address: dto.address },
      { matchedName: dto.ownerName, additionalAddresses, status: '' },
      { maxScore: AI_ONLY_MAX_SCORE },
    );

    return [
      {
        matchedName: dto.ownerName,
        contactDetails: contactDetails.length > 0 ? contactDetails : undefined,
        sourceType: 'AI_WEB_SEARCH',
        confidenceScore: match.score,
        confidenceLabel: match.label,
        rationale: match.rationale,
      },
    ];
  }

  /**
   * Builds candidates for a DIFFERENT person/company than the one searched
   * for, found via the property-connection AI prompt (see
   * OpenRouterService.buildPropertyConnectionPrompt) — e.g. the actual
   * current registered owner, when it isn't the searched name. Requires
   * both a property address to anchor on and an independent address match,
   * since there's no name-similarity signal to lean on at all here. Always
   * capped at Low confidence: a single, unverified AI web search hit about
   * an entirely different identity is never trusted further than that.
   */
  private buildPropertyConnectionCandidates(
    dto: SearchRequestDto,
    contactLeads: ContactLead[],
    claimedLeads: Set<ContactLead>,
  ): SearchCandidate[] {
    if (!dto.address) {
      return [];
    }

    const alternativeLeads = contactLeads.filter(
      (lead) =>
        !claimedLeads.has(lead) &&
        lead.name &&
        !namesCorroborate(lead.name, dto.ownerName) &&
        hasCorroboratingAddressSignal(lead, [dto.address]),
    );
    if (alternativeLeads.length === 0) {
      return [];
    }

    const groups = new Map<string, ContactLead[]>();
    for (const lead of alternativeLeads) {
      const key = normalizeName(lead.name!);
      groups.set(key, [...(groups.get(key) ?? []), lead]);
    }

    return [...groups.values()].map((leads) => {
      const name = leads[0].name!;
      const addressScore = Math.max(
        ...leads.map((lead) =>
          addressSimilarityScore(dto.address, [lead.address, lead.other, lead.quote].filter(Boolean).join(' ')),
        ),
      );
      // hasCorroboratingAddressSignal already guarantees addressScore >= 20
      // (the corroboration threshold), so this always lands in the Low band.
      const score = Math.min(AI_ONLY_MAX_SCORE, addressScore);
      const contactDetails = this.buildContactDetails(leads);
      const relationshipNote = [...new Set(leads.map((lead) => lead.relationshipNote).filter(Boolean))].join('; ');
      const bestAddress = leads.find((lead) => lead.address)?.address ?? dto.address;

      return {
        matchedName: name,
        contactDetails: contactDetails.length > 0 ? contactDetails : undefined,
        sourceType: 'AI_PROPERTY_CONNECTION',
        confidenceScore: score,
        // Guaranteed by the >= 20 address-corroboration gate above.
        confidenceLabel: 'Low',
        rationale: `"${name}" is a different name than searched ("${dto.ownerName}") but public web search found them connected to "${dto.address}"${relationshipNote ? ` (${relationshipNote})` : ''}; matching address: ${bestAddress}; this is a single, unverified source and should be manually confirmed.`,
      };
    });
  }

  /**
   * Fetches NZBN Entity Detail for every distinct company found by Entity/Role
   * Search (a data dependency, not a confidence-based gate — see
   * IMPLEMENTATION_PLAN.md section 2). Each lookup is independent: a failure
   * only adds a warning, it never removes candidates that Entity/Role Search
   * already found.
   */
  private async fetchNzbnDetails(
    rawCandidates: RawCandidate[],
    warnings: string[],
  ): Promise<Map<string, NzbnEntityDetail>> {
    const uniqueNzbns = [
      ...new Set(rawCandidates.map((candidate) => candidate.companyNzbn).filter((nzbn): nzbn is string => !!nzbn)),
    ];
    const detailsByNzbn = new Map<string, NzbnEntityDetail>();
    if (uniqueNzbns.length === 0) {
      return detailsByNzbn;
    }

    const settled = await Promise.allSettled(uniqueNzbns.map((nzbn) => this.nzbnClient.getEntityDetail(nzbn)));
    settled.forEach((result, index) => {
      const nzbn = uniqueNzbns[index];
      if (result.status === 'fulfilled') {
        detailsByNzbn.set(nzbn, result.value);
      } else {
        this.logger.warn(`NZBN entity detail unavailable for ${nzbn}: ${result.reason}`);
      }
    });

    const failedCount = uniqueNzbns.length - detailsByNzbn.size;
    if (failedCount > 0) {
      warnings.push(
        failedCount === uniqueNzbns.length
          ? 'NZBN company detail unavailable'
          : `NZBN company detail unavailable for ${failedCount} of ${uniqueNzbns.length} companies`,
      );
    }

    return detailsByNzbn;
  }

  private findRegisteredAddress(detail: NzbnEntityDetail): string | undefined {
    const addressList = detail.addresses?.addressList ?? [];
    const registered = addressList.find((address) => address.addressType === 'REGISTERED');
    return formatNzbnAddress(registered ?? addressList[0] ?? {});
  }
}
