import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiQuery, ApiBody } from '@nestjs/swagger';

import { MemesService } from './memes.service';
import { ExploreFeedDto } from './dto/explore-feed.dto';
import { MemeCaptionsQueryDto } from './dto/meme-captions-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { User } from '@prisma/client';

const MAX_MEME_SIZE = 10 * 1024 * 1024; // 10 MB

@ApiTags('memes')
@Controller({ path: 'memes', version: '1' })
export class MemesController {
  constructor(private readonly memesService: MemesService) {}

  // ─── IMPORTANT: Specific routes must come BEFORE /:id ────────────────────────

  @Post('upload')
  @ApiBearerAuth('access-token')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_MEME_SIZE } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a meme image (jpg/png/gif/webp, max 10MB)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  upload(
    @CurrentUser() user: User,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_MEME_SIZE }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|gif|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.memesService.uploadMeme(user.id, file);
  }

  @Post('explore')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get random unseen memes with top 3 captions each' })
  explore(@CurrentUser() user: User | undefined, @Body() dto: ExploreFeedDto) {
    return this.memesService.explore(dto, user?.id);
  }

  @Get('search')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Search memes by caption text' })
  @ApiQuery({ name: 'q', description: 'Search query', example: 'funny cat' })
  search(
    @CurrentUser() user: User | undefined,
    @Query('q') q: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.memesService.search(q, pagination);
  }

  @Post('feed/followings')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Following feed — memes captioned by users you follow' })
  getFollowingFeed(@CurrentUser() user: User, @Body() dto: ExploreFeedDto) {
    return this.memesService.getFollowingFeed(user.id, dto);
  }

  @Post('feed/explore')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Algorithmic "For You" feed based on languages and engagement' })
  getExploreFeed(@CurrentUser() user: User, @Body() dto: ExploreFeedDto) {
    return this.memesService.getExploreFeed(user.id, dto);
  }

  @Get('feed/explore/:memeId/captions')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Load more captions for a meme in the explore feed' })
  getFeedMemeCaptions(
    @CurrentUser() user: User,
    @Param('memeId', ParseUUIDPipe) memeId: string,
    @Query() query: MemeCaptionsQueryDto,
  ) {
    return this.memesService.getFeedMemeCaptions(memeId, query, user.id);
  }

  @Get('trending')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Trending memes — most captioned in last 7 days' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  getTrending(@CurrentUser() user: User | undefined, @Query() pagination: PaginationDto) {
    return this.memesService.getTrending(pagination, user?.id);
  }

  // ─── Dynamic routes (/:id) AFTER all specific routes ─────────────────────────

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get a single meme' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.memesService.findById(id);
  }

  @Get(':id/captions')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get paginated captions for a meme (rank / recent / top)' })
  getMemeCaptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MemeCaptionsQueryDto,
    @CurrentUser() user: User | undefined,
  ) {
    return this.memesService.getMemeCaptions(id, query, user?.id);
  }

  @Delete(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Soft-delete a meme' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.memesService.delete(id);
  }
}
