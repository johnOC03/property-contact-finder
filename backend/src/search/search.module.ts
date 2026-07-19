import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { MbieModule } from '../mbie/mbie.module';
import { AiModule } from '../ai/ai.module';
import { MatchingModule } from '../matching/matching.module';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [MbieModule, AiModule, MatchingModule, ContactsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
