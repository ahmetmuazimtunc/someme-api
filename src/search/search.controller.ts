import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';

import { SearchService } from './search.service';
import { Public } from '../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UseGuards } from '@nestjs/common';
import { User } from '@prisma/client';

@ApiTags('search')
@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Universal live search — returns users (type 1), tags (type 2), captions (type 3)',
  })
  @ApiQuery({ name: 'q', description: 'Search query (as-you-type)', example: 'funny' })
  @ApiResponse({
    status: 200,
    description: 'Mixed results array',
    schema: {
      example: {
        results: [
          {
            type: 1,
            id: 'uuid',
            username: 'johndoe',
            display_name: 'John Doe',
            photo: 'https://cdn.../avatar.jpg',
            is_verified: true,
            followers_count: 1200,
            is_following: false,
          },
          {
            type: 2,
            name: '#funny',
            caption_count: 342,
          },
          {
            type: 3,
            id: 'uuid',
            text: 'When the code works on first try 😱',
            is_liked: false,
            likes_count: 88,
            meme: { id: 'uuid', thumbnailUrl: 'https://cdn.../thumb.jpg' },
            user: { id: 'uuid', username: 'johndoe', is_verified: true },
          },
        ],
      },
    },
  })
  search(@CurrentUser() user: User | undefined, @Query('q') q: string) {
    return this.searchService.universalSearch(q ?? '', user?.id);
  }
}
