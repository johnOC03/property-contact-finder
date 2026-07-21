import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { SearchStatus } from '@prisma/client';
import { SearchService } from './search.service';
import { EntityRoleClientService } from '../mbie/entity-role-client.service';
import { NzbnClientService } from '../mbie/nzbn-client.service';
import { MbieCacheService } from '../mbie/mbie-cache.service';
import { OpenRouterService } from '../ai/open-router.service';
import { MatchingService } from '../matching/matching.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SearchService', () => {
  let service: SearchService;
  let entityRoleClient: EntityRoleClientService;
  let openRouterService: OpenRouterService;
  let prismaService: { searchRequest: { create: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prismaService = {
      searchRequest: {
        create: jest.fn().mockResolvedValue({ id: 'search-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule, ConfigModule.forRoot({ isGlobal: true, envFilePath: '../.env' })],
      providers: [
        SearchService,
        EntityRoleClientService,
        NzbnClientService,
        {
          provide: MbieCacheService,
          useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) },
        },
        OpenRouterService,
        MatchingService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    entityRoleClient = module.get<EntityRoleClientService>(EntityRoleClientService);
    openRouterService = module.get<OpenRouterService>(OpenRouterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a PENDING search record up front and marks it COMPLETED with the result/warnings JSON', async () => {
    jest
      .spyOn(entityRoleClient, 'searchPersonRoles')
      .mockResolvedValue({ pageSize: 10, currentPage: 1, totalResults: 0, roles: [] });
    jest.spyOn(openRouterService, 'searchContactDetailsEnsemble').mockResolvedValue([]);

    const result = await service.search({ ownerName: 'John Smith', address: '12 Queen St' });

    expect(prismaService.searchRequest.create).toHaveBeenCalledWith({
      data: { ownerName: 'John Smith', propertyAddress: '12 Queen St' },
    });
    expect(prismaService.searchRequest.update).toHaveBeenCalledWith({
      where: { id: 'search-1' },
      data: {
        status: SearchStatus.COMPLETED,
        resultJson: { candidates: result.candidates, otherPossibleMatches: result.otherPossibleMatches },
        warningsJson: result.warnings,
      },
    });
  });

  it('marks the search as FAILED with the error message and rethrows when persisting the result fails', async () => {
    jest
      .spyOn(entityRoleClient, 'searchPersonRoles')
      .mockResolvedValue({ pageSize: 10, currentPage: 1, totalResults: 0, roles: [] });
    jest.spyOn(openRouterService, 'searchContactDetailsEnsemble').mockResolvedValue([]);
    prismaService.searchRequest.update.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(service.search({ ownerName: 'John Smith' })).rejects.toThrow('db unavailable');

    expect(prismaService.searchRequest.update).toHaveBeenCalledTimes(2);
    expect(prismaService.searchRequest.update).toHaveBeenLastCalledWith({
      where: { id: 'search-1' },
      data: { status: SearchStatus.FAILED, errorMessage: 'db unavailable' },
    });
  });

  it('surfaces an AI-web-search-only candidate (no MBIE record at all), capped at Low confidence', async () => {
    jest
      .spyOn(entityRoleClient, 'searchPersonRoles')
      .mockResolvedValue({ pageSize: 10, currentPage: 1, totalResults: 0, roles: [] });
    jest.spyOn(openRouterService, 'searchContactDetailsEnsemble').mockResolvedValue([
      {
        name: 'Jane Doe',
        phone: '09 555 1234',
        sourceUrl: 'https://www.yellow.co.nz/jane-doe',
        quote: 'Jane Doe, 12 Queen Street, Auckland',
      },
    ]);

    const result = await service.search({ ownerName: 'Jane Doe', address: '12 Queen Street, Auckland' });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      matchedName: 'Jane Doe',
      sourceType: 'AI_WEB_SEARCH',
      confidenceLabel: 'Low',
    });
    expect(result.candidates[0].confidenceScore).toBeLessThan(50);
    expect(result.candidates[0].roleType).toBeUndefined();
  });

  it('does not surface a candidate for an AI web search lead whose name does not match the search input', async () => {
    jest
      .spyOn(entityRoleClient, 'searchPersonRoles')
      .mockResolvedValue({ pageSize: 10, currentPage: 1, totalResults: 0, roles: [] });
    jest
      .spyOn(openRouterService, 'searchContactDetailsEnsemble')
      .mockResolvedValue([{ name: 'Someone Unrelated', phone: '09 555 1234' }]);

    const result = await service.search({ ownerName: 'Jane Doe', address: '12 Queen Street, Auckland' });

    expect(result.candidates).toHaveLength(0);
  });

  it('surfaces a different, more strongly connected person found via the property-connection prompt, capped at Low', async () => {
    jest
      .spyOn(entityRoleClient, 'searchPersonRoles')
      .mockResolvedValue({ pageSize: 10, currentPage: 1, totalResults: 0, roles: [] });
    jest.spyOn(openRouterService, 'searchContactDetailsEnsemble').mockResolvedValue([
      {
        name: 'Michael Chen',
        phone: '09 555 6789',
        address: '12 Queen Street, Auckland',
        relationshipNote: 'Director of a company registered at this address',
        sourceUrl: 'https://www.companies-office.govt.nz/example',
        quote: 'Michael Chen, director',
      },
    ]);

    const result = await service.search({ ownerName: 'Jane Doe', address: '12 Queen Street, Auckland' });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      matchedName: 'Michael Chen',
      sourceType: 'AI_PROPERTY_CONNECTION',
      confidenceLabel: 'Low',
    });
    expect(result.candidates[0].confidenceScore).toBeLessThan(50);
    expect(result.candidates[0].rationale).toContain('Michael Chen');
    expect(result.candidates[0].rationale).toContain('Jane Doe');
  });

  it('does not surface a property-connection candidate when no property address was searched', async () => {
    jest
      .spyOn(entityRoleClient, 'searchPersonRoles')
      .mockResolvedValue({ pageSize: 10, currentPage: 1, totalResults: 0, roles: [] });
    jest.spyOn(openRouterService, 'searchContactDetailsEnsemble').mockResolvedValue([
      {
        name: 'Michael Chen',
        phone: '09 555 6789',
        address: '12 Queen Street, Auckland',
        relationshipNote: 'Director of a company registered at this address',
      },
    ]);

    const result = await service.search({ ownerName: 'Jane Doe' });

    expect(result.candidates).toHaveLength(0);
  });

  it('does not surface a property-connection candidate when the different person has no matching address signal', async () => {
    jest
      .spyOn(entityRoleClient, 'searchPersonRoles')
      .mockResolvedValue({ pageSize: 10, currentPage: 1, totalResults: 0, roles: [] });
    jest
      .spyOn(openRouterService, 'searchContactDetailsEnsemble')
      .mockResolvedValue([{ name: 'Michael Chen', phone: '09 555 6789' }]);

    const result = await service.search({ ownerName: 'Jane Doe', address: '12 Queen Street, Auckland' });

    expect(result.candidates).toHaveLength(0);
  });
});
