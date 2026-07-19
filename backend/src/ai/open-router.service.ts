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
  sourceUrl?: string;
  quote?: string;
}

interface OpenRouterChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const OPENROUTER_MODEL = 'perplexity/sonar';

const SYSTEM_PROMPT = [
  'You are a research assistant that finds PUBLIC New Zealand contact details',
  '(phone numbers, email addresses, or other public contact methods) for a named',
  'individual, strictly from information already published on the public web.',
  'Never invent, guess, or infer a contact detail you cannot cite a real source URL for.',
  'Respond with ONLY raw JSON (no markdown code fences, no commentary before or after).',
].join(' ');

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

  private buildPrompt(ownerName: string, address?: string): string {
    const addressClue = address
      ? ` They may be connected to this New Zealand property address: "${address}".`
      : '';
    return [
      `Find public New Zealand contact details (phone number, email, or other public contact method)`,
      `for a person named "${ownerName}".${addressClue}`,
      'Search these sources in priority order, and stop as soon as you find a reliable result:',
      '1. yellow.co.nz (NZ Yellow Pages) and whitepages.co.nz.',
      '2. Professional/regulatory registries the person may be listed on, since property owners are',
      '   often company directors or trustees: lawsociety.org.nz (NZ Law Society), reaa.govt.nz (Real',
      '   Estate Authority), lbp.govt.nz (Licensed Building Practitioners), charities.govt.nz (Charities',
      '   Register — common for property trusts), and CA ANZ (Chartered Accountants).',
      '3. Real estate agency "our agents"/"our team" pages (Barfoot & Thompson, Ray White, Harcourts,',
      '   LJ Hooker, Bayleys) if the person may be an agent.',
      '4. Company "Contact Us"/"Our Team" pages, NZ news articles (e.g. stuff.co.nz, nzherald.co.nz),',
      '   and other public listings.',
      'Only include entries you can support with a real, specific source URL you found via web search.',
      'Do not fabricate names, numbers, emails, or URLs.',
      '',
      'Respond with ONLY a JSON array (no markdown fences, no extra text) where each element looks like:',
      '{"name": string, "email": string | null, "phone": string | null, "other": string | null, "sourceUrl": string, "quote": string}',
      'If you find no reliable public contact details, respond with exactly: []',
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
