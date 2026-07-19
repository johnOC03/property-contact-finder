import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { PlacesClientService } from './places-client.service';

describe('PlacesClientService', () => {
  let service: PlacesClientService;
  let httpService: { get: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    httpService = { get: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('test-key') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlacesClientService,
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<PlacesClientService>(PlacesClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws if GOOGLE_PLACES_API_KEY is not configured', async () => {
    configService.get.mockReturnValue(undefined);

    await expect(service.autocomplete('12 Queen')).rejects.toThrow(
      'GOOGLE_PLACES_API_KEY is not configured',
    );
    expect(httpService.get).not.toHaveBeenCalled();
  });

  it('returns an empty array without calling the API for blank input', async () => {
    const result = await service.autocomplete('   ');

    expect(result).toEqual([]);
    expect(httpService.get).not.toHaveBeenCalled();
  });

  it('sends the API key as a query param and restricts to NZ addresses', async () => {
    httpService.get.mockReturnValue(of({ data: { predictions: [] } }));

    await service.autocomplete('12 Queen Street');

    expect(httpService.get).toHaveBeenCalledWith(
      'https://maps.googleapis.com/maps/api/place/autocomplete/json',
      expect.objectContaining({
        params: expect.objectContaining({
          input: '12 Queen Street',
          key: 'test-key',
          components: 'country:nz',
          types: 'address',
        }),
      }),
    );
  });

  it('maps predictions to description/placeId only, no coordinates', async () => {
    httpService.get.mockReturnValue(
      of({
        data: {
          predictions: [
            { description: '12 Queen Street, Auckland, New Zealand', place_id: 'abc123' },
          ],
        },
      }),
    );

    const result = await service.autocomplete('12 Queen');

    expect(result).toEqual([
      { description: '12 Queen Street, Auckland, New Zealand', placeId: 'abc123' },
    ]);
  });

  it('wraps and logs axios errors without throwing raw axios details', async () => {
    httpService.get.mockReturnValue(throwError(() => new Error('network down')));

    await expect(service.autocomplete('12 Queen')).rejects.toThrow(
      'Google Places Autocomplete request failed: network down',
    );
  });
});
