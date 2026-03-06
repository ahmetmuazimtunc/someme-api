import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { TagsService } from './tags.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { UseGuards } from '@nestjs/common';

@ApiTags('Tags')
@Controller({ path: 'tags', version: '1' })
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  // GET /tags/trending
  @Get('trending')
  @Public()
  @ApiOperation({ summary: 'Get 8 trending hashtags from last 24 hours' })
  async getTrending() {
    const topics = await this.tagsService.getTrendingTopics();
    return { data: topics };
  }

  // GET /tags/search?query=funny
  @Get('search')
  @Public()
  @ApiOperation({ summary: 'Search tags by name (for autocomplete)' })
  @ApiQuery({ name: 'query', required: true })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async searchTags(@Query('query') query: string, @Query() pagination: PaginationDto) {
    return this.tagsService.searchTags(query ?? '', pagination);
  }

  // GET /tags/:name/memes
  @Get(':name/memes')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get memes that have captions using this tag' })
  @ApiParam({ name: 'name', description: 'Tag name without # (e.g. "funny")' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getMemesByTag(
    @Param('name') name: string,
    @Query() pagination: PaginationDto,
    @CurrentUser('id') userId?: string,
  ) {
    return this.tagsService.getMemesByTag(name, pagination, userId);
  }
}
