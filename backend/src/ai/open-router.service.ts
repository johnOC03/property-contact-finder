import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';

/** A single public contact-detail lead surfaced by AI web search. */
export interface ContactLead {
  name?: string;
  email?: string;
  phone?: string;
  other?: string;
  /** Any residential/business address the model found associated with this
   * person, reported explicitly rather than inferred from free text. */
  address?: string;
  /** Why the model believes `name` is connected to the searched property
   * address — populated when `name` differs from the person that was
   * searched for (see `buildPropertyConnectionPrompt`). */
  relationshipNote?: string;
  sourceUrl?: string;
  quote?: string;
}

interface OpenRouterChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const OPENROUTER_MODEL = 'perplexity/sonar';

/**
 * Sonar's own live web search/retrieval step is non-deterministic even at
 * temperature 0 (temperature only affects token sampling, not what the
 * retrieval step finds) — an identical query can return a real, findable
 * lead on one call and `[]` on another. Firing this many independent,
 * parallel calls and merging the results (see `searchContactDetailsEnsemble`)
 * recovers most of those misses, at the cost of ~N times the request volume.
 */
const AI_SEARCH_ENSEMBLE_SIZE = 3;

const SYSTEM_PROMPT = [
  'You are a research assistant whose primary job is to find PUBLIC New Zealand contact details (phone',
  'numbers, email addresses, or other public contact methods) for a named individual, strictly from',
  'information already published on the public web — this always applies, regardless of whether a property',
  'address is also being investigated.',
  'When a property address is provided, you additionally check, as a separate task, whether a different',
  'named individual or company is more strongly connected to that exact address — but this never replaces',
  'or gates the primary contact-detail search for the named individual.',
  'Never invent, guess, or infer a name, contact detail, address, or relationship you cannot cite a real',
  'source URL for.',
  'Respond with ONLY raw JSON (no markdown code fences, no commentary before or after).',
].join(' ');

const SOURCE_LIST_LINES = [
  '1. yellow.co.nz (NZ Yellow Pages) and whitepages.co.nz.',
  '2. Professional/regulatory registries the person may be listed on, since property owners are',
  '   often company directors or trustees: lawsociety.org.nz (NZ Law Society), reaa.govt.nz (Real',
  '   Estate Authority), lbp.govt.nz (Licensed Building Practitioners), charities.govt.nz (Charities',
  '   Register — common for property trusts), and CA ANZ (Chartered Accountants).',
  '3. Real estate agency "our agents"/"our team" pages (Barfoot & Thompson, Ray White, Harcourts,',
  '   LJ Hooker, Bayleys) if the person may be an agent.',
  '4. Public professional/social profiles (LinkedIn) and general NZ business directories',
  '   (finda.co.nz, nzbusinesslist.co.nz) that may list a role, employer, or location.',
  '5. Property listing/valuation sites (homes.co.nz, oneroof.co.nz, trademe.co.nz/property) if the',
  '   person may be listed there as an agent, or the property itself has a public listing page.',
  '6. Company "Contact Us"/"Our Team" pages, NZ news articles (e.g. stuff.co.nz, nzherald.co.nz),',
  '   and other public listings.',
];

/**
 * Wraps the OpenRouter chat-completions API (see IMPLEMENTATION_PLAN.md
 * section 3/4) to run an AI-assisted public web search for a property
 * owner's contact details, using a model with built-in live web search
 * (`perplexity/sonar`) so results come with a citable source URL.
 *
 * Security notes:
 * - `OPENROUTER_API_KEY` is only ever attached as the `Authorization` header
 *   on requests to `https://openrouter.ai/api/v1/chat/completions` — it is
 *   never included in the prompt/body content and never forwarded anywhere
 *   else.
 * - The key (and every other secret in `.env`) is never logged. Only
 *   `error.message` is logged on failure, never the axios error's `config`/
 *   `request`/`response.headers`, which is what would otherwise leak the
 *   `Authorization` header.
 */
@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly baseUrl = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async searchContactDetails(ownerName: string, address?: string): Promise<ContactLead[]> {
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured');
    }

    const content = await this.callChatCompletion(apiKey, ownerName, address);
    return this.parseLeads(content);
  }

  /**
   * Runs `searchContactDetails` `runs` times in parallel and merges the
   * results, to reduce the impact of Sonar's per-call retrieval variance
   * (see `AI_SEARCH_ENSEMBLE_SIZE`). Each call is independent
   * (`Promise.allSettled`) — a failure in one doesn't discard leads found by
   * the others; only if every call fails does this rethrow (matching
   * `searchContactDetails`'s single-call failure behaviour, so callers can
   * keep treating this as a drop-in replacement).
   */
  async searchContactDetailsEnsemble(
    ownerName: string,
    address?: string,
    runs: number = AI_SEARCH_ENSEMBLE_SIZE,
  ): Promise<ContactLead[]> {
    const settled = await Promise.allSettled(
      Array.from({ length: runs }, () => this.searchContactDetails(ownerName, address)),
    );

    const fulfilled = settled.filter(
      (result): result is PromiseFulfilledResult<ContactLead[]> => result.status === 'fulfilled',
    );

    if (fulfilled.length === 0) {
      const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      throw firstFailure?.reason instanceof Error
        ? firstFailure.reason
        : new Error('OpenRouter web search ensemble: all calls failed');
    }

    const failedCount = settled.length - fulfilled.length;
    if (failedCount > 0) {
      this.logger.warn(`OpenRouter web search ensemble: ${failedCount}/${settled.length} calls failed`);
    }

    return this.dedupeLeads(fulfilled.flatMap((result) => result.value));
  }

  /**
   * Collapses leads that are effectively the same finding repeated across
   * ensemble runs (same name, same contact value(s), same source) into a
   * single entry, so a phone/email that two parallel calls both happened to
   * find doesn't get shown twice.
   */
  private dedupeLeads(leads: ContactLead[]): ContactLead[] {
    const seen = new Map<string, ContactLead>();
    for (const lead of leads) {
      const key = [
        lead.name?.trim().toLowerCase() ?? '',
        lead.phone?.trim().toLowerCase() ?? '',
        lead.email?.trim().toLowerCase() ?? '',
        lead.other?.trim().toLowerCase() ?? '',
        lead.address?.trim().toLowerCase() ?? '',
        lead.sourceUrl?.trim().toLowerCase() ?? '',
      ].join('|');
      if (!seen.has(key)) {
        seen.set(key, lead);
      }
    }
    return [...seen.values()];
  }

  private async callChatCompletion(apiKey: string, ownerName: string, address?: string): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<OpenRouterChatResponse>(
          this.baseUrl,
          {
            model: OPENROUTER_MODEL,
            temperature: 0,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: this.buildPrompt(ownerName, address) },
            ],
          },
          {
            headers: {
              // Sent only to openrouter.ai, never logged, never echoed back
              // into any response we return or persist.
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 20000,
          },
        ),
      );
      return response.data.choices?.[0]?.message?.content ?? '';
    } catch (error) {
      const axiosError = error as AxiosError;
      // Deliberately log only the message — never `axiosError.config` or
      // `axiosError.request`, which would include the Authorization header.
      this.logger.warn(`OpenRouter web search failed: ${axiosError.message}`);
      throw new Error(`OpenRouter web search request failed: ${axiosError.message}`);
    }
  }

  /**
   * When an address is available, contact-detail lookup for the searched
   * name is still ALWAYS performed (never gated on confirming a connection
   * to the address first) — a second, independent task on top of that also
   * checks whether a different person/company is more strongly connected to
   * that exact address, reporting it as well rather than discarding it just
   * because the name differs. Falls back to a simpler name-only prompt when
   * there's no address to investigate at all.
   */
  private buildPrompt(ownerName: string, address?: string): string {
    return address ? this.buildPropertyConnectionPrompt(ownerName, address) : this.buildContactOnlyPrompt(ownerName);
  }

  private buildContactOnlyPrompt(ownerName: string): string {
    return [
      `Find public New Zealand contact details (phone number, email, or other public contact method)`,
      `for a person named "${ownerName}".`,
      'Search these sources in priority order, and stop as soon as you find a reliable result:',
      ...SOURCE_LIST_LINES,
      'Only include entries you can support with a real, specific source URL you found via web search.',
      'Do not fabricate names, numbers, emails, addresses, or URLs.',
      '',
      'If the source also states a residential or business address for this person, include it verbatim',
      'in the "address" field so it can be cross-checked — do not put it only in "quote".',
      '',
      'Respond with ONLY a JSON array (no markdown fences, no extra text) where each element looks like:',
      '{"name": string, "email": string | null, "phone": string | null, "other": string | null, "address": string | null, "sourceUrl": string, "quote": string}',
      'If you find no reliable public contact details, respond with exactly: []',
    ].join('\n');
  }

  private buildPropertyConnectionPrompt(ownerName: string, address: string): string {
    return [
      `You have two independent tasks. A property address is involved ("${address}"), but TASK A below is`,
      'never conditional on anything found while investigating it — always complete TASK A in full.',
      '',
      `TASK A (always do this): Find public New Zealand contact details (phone number, email, or other`,
      `public contact method) for a person named "${ownerName}". Search these sources in priority order:`,
      ...SOURCE_LIST_LINES,
      `Report anything you find for "${ownerName}" even if you cannot independently confirm they are`,
      `connected to "${address}" — that cross-check happens separately downstream, so do not withhold or`,
      'discard a genuine contact-detail finding just because this exact address isn\'t confirmed in the',
      'same source.',
      '',
      `TASK B (additional, separate from Task A): Also check whether a DIFFERENT named person or company —`,
      `not "${ownerName}" — is publicly connected to this exact address: "${address}" (e.g. listed as its`,
      'registered owner, a director/shareholder of a company registered at or near this address, an',
      'occupant, a real estate agent for a listing at this address, or mentioned in a news article about a',
      'sale/transaction at this address). Search the same source list above for this. If you find one,',
      'report them as an additional entry, explaining the connection in the "relationshipNote" field, and',
      'also search for their public contact details (a bonus, not a requirement — still report the entry',
      'with "email"/"phone"/"other" left null if you find no contact detail for them).',
      '',
      'Only include entries you can support with a real, specific source URL you found via web search.',
      'Do not fabricate names, numbers, emails, addresses, relationships, or URLs.',
      '',
      'If a source states a residential or business address for a person, include it verbatim in the',
      '"address" field so it can be cross-checked — do not put it only in "quote".',
      '',
      'Respond with ONLY a JSON array (no markdown fences, no extra text) where each element looks like:',
      '{"name": string, "email": string | null, "phone": string | null, "other": string | null, "address": string | null, "relationshipNote": string | null, "sourceUrl": string, "quote": string}',
      `Only respond with exactly [] if TASK A found no public contact details for "${ownerName}" AND TASK B`,
      'found no differently-named person/company connected to the address.',
    ].join('\n');
  }

  private parseLeads(content: string): ContactLead[] {
    const jsonText = this.extractJsonArray(content);
    if (!jsonText) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      this.logger.warn('OpenRouter response was not valid JSON; returning no leads.');
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        name: typeof item.name === 'string' ? item.name : undefined,
        email: typeof item.email === 'string' ? item.email : undefined,
        phone: typeof item.phone === 'string' ? item.phone : undefined,
        other: typeof item.other === 'string' ? item.other : undefined,
        address: typeof item.address === 'string' ? item.address : undefined,
        relationshipNote: typeof item.relationshipNote === 'string' ? item.relationshipNote : undefined,
        sourceUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl : undefined,
        quote: typeof item.quote === 'string' ? item.quote : undefined,
      }));
  }

  /** Strips markdown code fences (in case the model adds them anyway) and isolates the JSON array. */
  private extractJsonArray(content: string): string | null {
    const trimmed = content.trim();
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) {
      return null;
    }
    return candidate.slice(start, end + 1);
  }
}
