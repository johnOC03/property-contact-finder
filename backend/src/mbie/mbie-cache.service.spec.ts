import { MbieCacheService } from './mbie-cache.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MbieCacheService', () => {
  let prisma: {
    mbieCache: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
    };
  };
  let service: MbieCacheService;

  beforeEach(() => {
    prisma = {
      mbieCache: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new MbieCacheService(prisma as unknown as PrismaService);
  });

  describe('get', () => {
    it('returns null on a cache miss', async () => {
      prisma.mbieCache.findUnique.mockResolvedValue(null);
      expect(await service.get('some-key')).toBeNull();
    });

    it('returns the cached response when not expired', async () => {
      prisma.mbieCache.findUnique.mockResolvedValue({
        response: { roles: [] },
        expiresAt: new Date(Date.now() + 60000),
      });
      expect(await service.get('some-key')).toEqual({ roles: [] });
    });

    it('returns null and deletes the entry when expired', async () => {
      prisma.mbieCache.findUnique.mockResolvedValue({
        response: { roles: [] },
        expiresAt: new Date(Date.now() - 1000),
      });
      prisma.mbieCache.delete.mockResolvedValue(undefined);
      expect(await service.get('some-key')).toBeNull();
      expect(prisma.mbieCache.delete).toHaveBeenCalledWith({ where: { requestSignature: 'some-key' } });
    });

    it('returns null (not throw) when the read fails', async () => {
      prisma.mbieCache.findUnique.mockRejectedValue(new Error('db unavailable'));
      expect(await service.get('some-key')).toBeNull();
    });
  });

  describe('set', () => {
    it('upserts a cache entry with an expiry in the future', async () => {
      prisma.mbieCache.upsert.mockResolvedValue(undefined);
      await service.set('some-key', 'https://example.com', { roles: [] }, 5000);

      expect(prisma.mbieCache.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.mbieCache.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ requestSignature: 'some-key' });
      expect(call.create.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('does not throw when the write fails', async () => {
      prisma.mbieCache.upsert.mockRejectedValue(new Error('db unavailable'));
      await expect(service.set('some-key', 'https://example.com', {})).resolves.toBeUndefined();
    });
  });
});
