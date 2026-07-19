import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PlacesController } from './places.controller';
import { PlacesClientService } from './places-client.service';

@Module({
  imports: [HttpModule],
  controllers: [PlacesController],
  providers: [PlacesClientService],
  exports: [PlacesClientService],
})
export class PlacesModule {}
