import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';
import { MbieCacheService } from './mbie-cache.service';

export interface EntityRoleAddress {
  addressLines: string[];
  postCode?: string;
  countryCode?: string;
  pafId?: string;
}

export interface EntityRoleRecord {
  firstName: string;
  lastName: string;
  roleType: string;
  status: string;
  associatedCompanyName?: string;
  associatedCompanyNumber?: string;
  associatedCompanyNzbn?: string;
  associatedCompanyStatusCode?: string;
  appointmentDate?: string;
  resignationDate?: string;
  physicalAddress?: EntityRoleAddress;
  shareholdings?: unknown[];
}

export interface EntityRoleSearchResult {
  pageSize: number;
  currentPage: number;
  totalResults: number;
  roles: EntityRoleRecord[];
}

/**
 * Client for the MBIE Companies Entity Role Search API (v3).
 * Docs: https://portal.api.business.govt.nz/api-details#api=companies-entity-role-search-v3
 */
@Injectable()
export class EntityRoleClientService {
  private readonly logger = new Logger(EntityRoleClientService.name);
  private readonly baseUrl =
    'https://api.business.govt.nz/gateway/companies-office/companies-register/entity-roles/v3/search';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly mbieCache: MbieCacheService,
  ) {}

  async searchPersonRoles(name: string): Promise<EntityRoleSearchResult> {
    const cacheKey = `entity-role-search:${name.trim().toLowerCase()}`;
    const cached = await this.mbieCache.get<EntityRoleSearchResult>(cacheKey);
    if (cached) {
      this.logger.debug(`Entity/Role Search cache hit for "${name}"`);
      return cached;
    }

    const apiKey = this.configService.get<string>('MBIE_ENTITY_ROLE_SEARCH_API_KEY');
    if (!apiKey) {
      throw new Error('MBIE_ENTITY_ROLE_SEARCH_API_KEY is not configured');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<EntityRoleSearchResult>(this.baseUrl, {
          params: {
            name,
            page: 1,
            'page-size': 10,
            'registered-only': true,
            'role-type': 'ALL',
          },
          headers: {
            'Ocp-Apim-Subscription-Key': apiKey,
            // The API defaults to XML unless JSON is explicitly requested.
            Accept: 'application/json',
          },
          timeout: 8000,
        }),
      );
      await this.mbieCache.set(cacheKey, this.baseUrl, response.data);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.warn(`Entity/Role Search failed for "${name}": ${axiosError.message}`);
      throw new Error(`MBIE Entity/Role Search request failed: ${axiosError.message}`);
    }
  }
}
