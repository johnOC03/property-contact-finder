import { Controller, Get, Query } from '@nestjs/common';
import { PlacesClientService, AddressSuggestion } from './places-client.service';
import { AutocompleteQueryDto } from './dto/autocomplete-query.dto';

@Controller('places')
export class PlacesController {
  constructor(private readonly placesClientService: PlacesClientService) {}

  @Get('autocomplete')
  async autocomplete(
    @Query() query: AutocompleteQueryDto,
  ): Promise<{ predictions: AddressSuggestion[] }> {
    const predictions = await this.placesClientService.autocomplete(query.input);
    return { predictions };
  }
}
