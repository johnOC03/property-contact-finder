import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';
import { MbieCacheService } from './mbie-cache.service';

export interface NzbnAddress {
  address1?: string;
  address2?: string;
  address3?: string;
  address4?: string;
  postCode?: string;
  countryCode?: string;
  addressType?: 'REGISTERED' | 'SERVICE' | 'SHAREREGISTER' | string;
}

export interface NzbnRolePerson {
  firstName?: string;
  middleNames?: string;
  lastName?: string;
}

export interface NzbnRole {
  roleType: string;
  roleStatus: string;
  rolePerson?: NzbnRolePerson;
  roleAddress?: NzbnAddress[];
}

export interface NzbnIndividualShareholder {
  firstName?: string;
  middleNames?: string;
  lastName?: string;
  fullName?: string;
}

export interface NzbnShareholder {
  type: string;
  individualShareholder?: NzbnIndividualShareholder;
  shareholderAddress?: NzbnAddress;
}

export interface NzbnEntityDetail {
  entityName: string;
  nzbn: string;
  entityStatusDescription: string;
  addresses?: { addressList?: NzbnAddress[] };
  roles?: NzbnRole[];
  'company-details'?: {
    shareholding?: {
      shareAllocation?: Array<{ shareholder?: NzbnShareholder[] }>;
    };
  };
}

/**
 * Formats an NZBN address record into a single display string. Returns
 * undefined if the address has no usable line content.
 */
export function formatNzbnAddress(address: NzbnAddress): string | undefined {
  const parts = [address.address1, address.address2, address.address3, address.address4].filter(
    (part): part is string => !!part && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Client for the MBIE NZBN API (v5). Despite the "Companies Register" env
 * var name, this key authenticates against the NZBN API, not the separate
 * incorporation/administration "Companies v2" API — see
 * /memories/repo/mbie-apis.md for how that was discovered.
 */
@Injectable()
export class NzbnClientService {
  private readonly logger = new Logger(NzbnClientService.name);
  private readonly baseUrl = 'https://api.business.govt.nz/gateway/nzbn/v5/entities';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly mbieCache: MbieCacheService,
  ) {}

  async getEntityDetail(nzbn: string): Promise<NzbnEntityDetail> {
    const cacheKey = `nzbn-entity:${nzbn}`;
    const cached = await this.mbieCache.get<NzbnEntityDetail>(cacheKey);
    if (cached) {
      this.logger.debug(`NZBN entity detail cache hit for "${nzbn}"`);
      return cached;
    }

    const apiKey = this.configService.get<string>('MBIE_COMPANIES_REGISTER_API_KEY');
    if (!apiKey) {
      throw new Error('MBIE_COMPANIES_REGISTER_API_KEY is not configured');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<NzbnEntityDetail>(`${this.baseUrl}/${nzbn}`, {
          headers: {
            'Ocp-Apim-Subscription-Key': apiKey,
            // Same "returns XML unless asked" quirk as Entity/Role Search.
            Accept: 'application/json',
          },
          timeout: 8000,
        }),
      );
      await this.mbieCache.set(cacheKey, this.baseUrl, response.data);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.warn(`NZBN entity detail failed for "${nzbn}": ${axiosError.message}`);
      throw new Error(`NZBN Entity Detail request failed: ${axiosError.message}`);
    }
  }
}
