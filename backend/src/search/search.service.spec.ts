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
    jest.spyOn(openRouterService, 'searchContactDetails').mockResolvedValue([]);

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
    jest.spyOn(openRouterService, 'searchContactDetails').mockResolvedValue([]);
    prismaService.searchRequest.update.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(service.search({ ownerName: 'John Smith' })).rejects.toThrow('db unavailable');

    expect(prismaService.searchRequest.update).toHaveBeenCalledTimes(2);
    expect(prismaService.searchRequest.update).toHaveBeenLastCalledWith({
      where: { id: 'search-1' },
      data: { status: SearchStatus.FAILED, errorMessage: 'db unavailable' },
    });
  });
});
