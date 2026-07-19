import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OpenRouterService } from './open-router.service';

@Module({
  imports: [HttpModule],
  providers: [OpenRouterService],
  exports: [OpenRouterService],
})
export class AiModule {}
