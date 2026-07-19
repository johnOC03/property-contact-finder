import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { SearchService, SearchResponse, SearchHistoryItem, SearchHistoryDetail } from './search.service';
import { SearchRequestDto } from './dto/search-request.dto';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post()
  async search(@Body() dto: SearchRequestDto): Promise<SearchResponse> {
    return this.searchService.search(dto);
  }

  @Get('history')
  async listHistory(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ): Promise<SearchHistoryItem[]> {
    return this.searchService.listHistory(limit);
  }

  @Get('history/:id')
  async getHistoryDetail(@Param('id') id: string): Promise<SearchHistoryDetail> {
    const detail = await this.searchService.getHistoryDetail(id);
    if (!detail) {
      throw new NotFoundException(`No search found with id "${id}"`);
    }
    return detail;
  }
}
