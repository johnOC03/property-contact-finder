import { Injectable, Logger } from '@nestjs/common';
import { SearchStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EntityRoleClientService } from '../mbie/entity-role-client.service';
import { formatNzbnAddress, NzbnClientService, NzbnEntityDetail } from '../mbie/nzbn-client.service';
import { ContactLead, OpenRouterService } from '../ai/open-router.service';
import { ConfidenceLabel, MatchingService } from '../matching/matching.service';
import { leadCorroboratesCandidate } from './lead-matching';
import { SearchRequestDto } from './dto/search-request.dto';

const YELLOW_OR_WHITE_PAGES_HOSTS = ['yellow.co.nz', 'whitepages.co.nz'];

export interface ContactDetail {
  type: 'email' | 'phone' | 'other';
  value: string;
  sourceUrl?: string;
  sourceType: 'YELLOW_PAGES' | 'WEB_SEARCH';
}

export interface SearchCandidate {
  matchedName: string;
  roleType: string;
  status: string;
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
  sourceType: 'MBIE_ENTITY_ROLE';
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
      this.openRouterService.searchContactDetails(dto.ownerName, dto.address),
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

    const scored: SearchCandidate[] = rawCandidates
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
      })
      .sort((a, b) => b.confidenceScore - a.confidenceScore);

    const candidates = scored.filter((candidate) => candidate.confidenceLabel !== null);
    const otherPossibleMatches = candidates.length === 0 ? scored.slice(0, MAX_OTHER_MATCHES) : [];

    return { candidates, otherPossibleMatches, warnings };
  }

  /**
   * Converts matched AI web search leads into displayable contact details,
   * tagging each as YELLOW_PAGES when the source URL is from a known
   * Yellow/White Pages host, or WEB_SEARCH otherwise.
   */
  private buildContactDetails(leads: ContactLead[]): ContactDetail[] {
    const details: ContactDetail[] = [];
    for (const lead of leads) {
      const sourceType: ContactDetail['sourceType'] =
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
    }
    return details;
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
