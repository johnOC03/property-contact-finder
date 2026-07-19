import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Naive fixed TTL — not a full sync, just enough to dodge repeat MBIE calls
 * during a demo/dev session. See IMPLEMENTATION_PLAN.md section 12. */
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Caches raw MBIE API responses (Entity/Role Search, NZBN Entity Detail) in
 * Postgres, keyed by a request signature, so repeated searches for the same
 * name/company don't re-hit the rate-limited MBIE APIs. A cache read/write
 * failure never breaks the caller — MBIE clients always fall back to a live
 * API call if the cache is unavailable or errors out.
 */
@Injectable()
export class MbieCacheService {
  private readonly logger = new Logger(MbieCacheService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(requestSignature: string): Promise<T | null> {
    try {
      const entry = await this.prisma.mbieCache.findUnique({ where: { requestSignature } });
      if (!entry) {
        return null;
      }
      if (entry.expiresAt.getTime() <= Date.now()) {
        // Expired — best-effort cleanup; a failure here shouldn't matter.
        this.prisma.mbieCache.delete({ where: { requestSignature } }).catch(() => undefined);
        return null;
      }
      return entry.response as T;
    } catch (error) {
      this.logger.warn(`MBIE cache read failed for "${requestSignature}": ${(error as Error).message}`);
      return null;
    }
  }

  async set(
    requestSignature: string,
    endpoint: string,
    response: unknown,
    ttlMs: number = DEFAULT_TTL_MS,
  ): Promise<void> {
    try {
      const expiresAt = new Date(Date.now() + ttlMs);
      await this.prisma.mbieCache.upsert({
        where: { requestSignature },
        create: {
          requestSignature,
          endpoint,
          response: response as Prisma.InputJsonValue,
          expiresAt,
        },
        update: {
          endpoint,
          response: response as Prisma.InputJsonValue,
          fetchedAt: new Date(),
          expiresAt,
        },
      });
    } catch (error) {
      this.logger.warn(`MBIE cache write failed for "${requestSignature}": ${(error as Error).message}`);
    }
  }
}
