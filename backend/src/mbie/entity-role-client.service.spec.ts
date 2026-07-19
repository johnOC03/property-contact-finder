import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { EntityRoleClientService } from './entity-role-client.service';
import { MbieCacheService } from './mbie-cache.service';

describe('EntityRoleClientService', () => {
  let service: EntityRoleClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule, ConfigModule.forRoot({ isGlobal: true, envFilePath: '../.env' })],
      providers: [
        EntityRoleClientService,
        {
          provide: MbieCacheService,
          useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<EntityRoleClientService>(EntityRoleClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
