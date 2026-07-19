import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { EntityRoleClientService } from './entity-role-client.service';
import { NzbnClientService } from './nzbn-client.service';
import { MbieCacheService } from './mbie-cache.service';

@Module({
  imports: [HttpModule, PrismaModule],
  providers: [EntityRoleClientService, NzbnClientService, MbieCacheService],
  exports: [EntityRoleClientService, NzbnClientService],
})
export class MbieModule {}
