import { Injectable } from '@nestjs/common';
import { addressSimilarityScore } from './address-similarity';
import { nameSimilarityScore } from './name-similarity';

export type ConfidenceLabel = 'High' | 'Medium' | 'Low';

export interface MatchInput {
  ownerName: string;
  address?: string;
}

export interface MatchableCandidate {
  matchedName: string;
  address?: string;
  /**
   * Extra known addresses for the same candidate/company beyond `address`
   * (e.g. NZBN registered/service addresses). The best-scoring one against
   * the input address wins — this is how NZBN Entity Detail data improves
   * the address signal without a separate scoring category.
   */
  additionalAddresses?: string[];
  status: string;
  companyName?: string;
  /** NZBN entityStatusDescription (e.g. "Registered" vs "Removed"). */
  companyStatus?: string;
  /**
   * True when an independent AI web search (OpenRouter/Sonar) hit a public
   * contact-details listing (e.g. Yellow Pages) under this same candidate's
   * name — a genuinely separate source from the MBIE data family, so it
   * earns the corroboration bonus rather than feeding `additionalAddresses`.
   */
  hasCorroboratingWebLead?: boolean;
}

export interface MatchBreakdown {
  nameScore: number;
  addressScore: number;
  corroborationBonus: number;
  statusDiscount: number;
}

export interface MatchResult {
  score: number;
  /** null means the score fell below the "shown" threshold (< 20). */
  label: ConfidenceLabel | null;
  rationale: string;
  breakdown: MatchBreakdown;
}

const INACTIVE_ROLE_STATUSES = new Set(['inactive', 'ceased', 'resigned', 'removed']);
const ACTIVE_COMPANY_STATUSES = new Set(['registered']);
const STATUS_DISCOUNT = 10;

/**
 * Deterministic, explainable scoring engine — see IMPLEMENTATION_PLAN.md
 * section 6. The score is never LLM-generated; only the rationale phrasing
 * is a candidate for later LLM polish.
 */
@Injectable()
export class MatchingService {
  score(input: MatchInput, candidate: MatchableCandidate): MatchResult {
    const nameScore = nameSimilarityScore(input.ownerName, candidate.matchedName);

    const candidateAddresses = [candidate.address, ...(candidate.additionalAddresses ?? [])].filter(
      (address): address is string => !!address,
    );
    let addressScore = 0;
    // Default to the first known address so the rationale always has
    // something concrete to reference, even when nothing scores above 0.
    let bestAddress: string | undefined = candidateAddresses[0];
    for (const address of candidateAddresses) {
      const candidateScore = addressSimilarityScore(input.address, address);
      if (candidateScore > addressScore) {
        addressScore = candidateScore;
        bestAddress = address;
      }
    }

    // Corroboration bonus (0-20): rewards agreement across independent
    // sources — an MBIE role AND an AI web search hit (e.g. Yellow Pages) on
    // the same name. NZBN detail does NOT trigger this bonus since it feeds
    // `additionalAddresses`/`companyStatus` above instead — it's the same
    // MBIE data family, not a genuinely independent corroborating source.
    const corroborationBonus = candidate.hasCorroboratingWebLead ? 20 : 0;

    const isRoleStale = INACTIVE_ROLE_STATUSES.has(candidate.status?.toLowerCase() ?? '');
    const isCompanyStale = candidate.companyStatus
      ? !ACTIVE_COMPANY_STATUSES.has(candidate.companyStatus.toLowerCase())
      : false;
    const isStale = isRoleStale || isCompanyStale;
    const statusDiscount = isStale ? STATUS_DISCOUNT : 0;

    const rawScore = nameScore + addressScore + corroborationBonus - statusDiscount;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    return {
      score,
      label: this.labelFor(score),
      rationale: this.buildRationale(input, candidate, {
        nameScore,
        addressScore,
        bestAddress,
        hasAnyAddress: candidateAddresses.length > 0,
        isRoleStale,
        isCompanyStale,
        hasCorroboratingWebLead: !!candidate.hasCorroboratingWebLead,
      }),
      breakdown: { nameScore, addressScore, corroborationBonus, statusDiscount },
    };
  }

  private labelFor(score: number): ConfidenceLabel | null {
    if (score >= 80) return 'High';
    if (score >= 50) return 'Medium';
    if (score >= 20) return 'Low';
    return null;
  }

  private buildRationale(
    input: MatchInput,
    candidate: MatchableCandidate,
    parts: {
      nameScore: number;
      addressScore: number;
      bestAddress?: string;
      hasAnyAddress: boolean;
      isRoleStale: boolean;
      isCompanyStale: boolean;
      hasCorroboratingWebLead: boolean;
    },
  ): string {
    const { nameScore, addressScore, bestAddress, hasAnyAddress, isRoleStale, isCompanyStale, hasCorroboratingWebLead } =
      parts;
    const clauses: string[] = [];

    if (nameScore >= 36) {
      clauses.push(`name closely matches "${input.ownerName}"`);
    } else if (nameScore >= 24) {
      clauses.push(`name is a partial match for "${input.ownerName}"`);
    } else {
      clauses.push(`name only loosely resembles "${input.ownerName}"`);
    }

    if (!input.address) {
      clauses.push('no property address was provided to corroborate');
    } else if (!hasAnyAddress) {
      clauses.push('no address on record for this candidate to compare');
    } else if (addressScore >= 40) {
      clauses.push(`address matches a known address (${bestAddress})`);
    } else if (addressScore >= 20) {
      clauses.push(`address partially overlaps with (${bestAddress})`);
    } else {
      clauses.push(`known address (${bestAddress}) does not match`);
    }

    if (candidate.companyName) {
      clauses.push(`via a role at ${candidate.companyName}`);
    }

    if (hasCorroboratingWebLead) {
      clauses.push('corroborated by a public web/Yellow Pages contact listing under the same name');
    }

    if (isRoleStale) {
      clauses.push(`role status "${candidate.status}" is not currently active, reducing confidence`);
    }
    if (isCompanyStale) {
      clauses.push(`company status "${candidate.companyStatus}" is not active, reducing confidence`);
    }

    return `${clauses[0]}; ${clauses.slice(1).join('; ')}.`;
  }
}
