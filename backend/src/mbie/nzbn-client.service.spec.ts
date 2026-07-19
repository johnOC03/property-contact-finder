import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { NzbnClientService, formatNzbnAddress } from './nzbn-client.service';
import { MbieCacheService } from './mbie-cache.service';

describe('NzbnClientService', () => {
  let service: NzbnClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule, ConfigModule.forRoot({ isGlobal: true, envFilePath: '../.env' })],
      providers: [
        NzbnClientService,
        {
          provide: MbieCacheService,
          useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<NzbnClientService>(NzbnClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('formatNzbnAddress', () => {
  it('joins non-empty address lines with a comma', () => {
    expect(
      formatNzbnAddress({
        address1: '9/14 Ruakura Road',
        address2: 'Hamilton East',
        address3: 'Hamilton',
        addressType: 'REGISTERED',
      }),
    ).toBe('9/14 Ruakura Road, Hamilton East, Hamilton');
  });

  it('skips empty/undefined lines', () => {
    expect(
      formatNzbnAddress({
        address1: '12 Queen St',
        address2: undefined,
        address3: 'Auckland',
        address4: '',
      }),
    ).toBe('12 Queen St, Auckland');
  });

  it('returns undefined when there are no usable lines', () => {
    expect(formatNzbnAddress({})).toBeUndefined();
  });
});
