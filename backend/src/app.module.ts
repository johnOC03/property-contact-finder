import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SearchModule } from './search/search.module';
import { MbieModule } from './mbie/mbie.module';
import { AiModule } from './ai/ai.module';
import { MatchingModule } from './matching/matching.module';
import { ContactsModule } from './contacts/contacts.module';
import { PlacesModule } from './places/places.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The .env file lives at the repo root, one level above this backend/ package.
      envFilePath: '../.env',
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }]),
    PrismaModule,
    SearchModule,
    MbieModule,
    AiModule,
    MatchingModule,
    ContactsModule,
    PlacesModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
