import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';

/** A single address suggestion — plain text only, no coordinates/place details. */
export interface AddressSuggestion {
  description: string;
  placeId: string;
}

interface GooglePlacesAutocompleteResponse {
  predictions?: Array<{ description: string; place_id: string }>;
}

/**
 * Client for the Google Places Autocomplete (legacy) API. Used purely to
 * suggest address text as the user types — deliberately does not fetch
 * Place Details, coordinates, or property boundaries.
 * Docs: https://developers.google.com/maps/documentation/places/web-service/autocomplete
 */
@Injectable()
export class PlacesClientService {
  private readonly logger = new Logger(PlacesClientService.name);
  private readonly baseUrl = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async autocomplete(input: string): Promise<AddressSuggestion[]> {
    const apiKey = this.configService.get<string>('GOOGLE_PLACES_API_KEY');
    if (!apiKey) {
      throw new Error('GOOGLE_PLACES_API_KEY is not configured');
    }

    if (!input.trim()) {
      return [];
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<GooglePlacesAutocompleteResponse>(this.baseUrl, {
          params: {
            input,
            key: apiKey,
            components: 'country:nz',
            types: 'address',
          },
          timeout: 5000,
        }),
      );

      return (response.data.predictions ?? []).map((p) => ({
        description: p.description,
        placeId: p.place_id,
      }));
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.warn(`Places Autocomplete failed for "${input}": ${axiosError.message}`);
      throw new Error(`Google Places Autocomplete request failed: ${axiosError.message}`);
    }
  }
}
