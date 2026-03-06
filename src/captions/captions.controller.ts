import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { CaptionsService } from './captions.service';
import { CreateCaptionDto } from './dto/create-caption.dto';
import { LikeCaptionDto } from './dto/like-caption.dto';
import { ViewCaptionDto } from './dto/view-caption.dto';
import { ReportCaptionDto } from './dto/report-caption.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { User } from '@prisma/client';

@ApiTags('captions')
@Controller({ path: 'captions', version: '1' })
export class CaptionsController {
  constructor(private readonly captionsService: CaptionsService) {}

  // ─── IMPORTANT: Specific routes BEFORE /:id ──────────────────────────────────

  @Post('create')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Add a caption to a meme' })
  create(@CurrentUser() user: User, @Body() dto: CreateCaptionDto) {
    return this.captionsService.create(user.id, dto);
  }

  @Post('like')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Like a caption' })
  like(@CurrentUser() user: User, @Body() dto: LikeCaptionDto) {
    return this.captionsService.like(dto.id, user.id);
  }

  @Delete('like')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Unlike a caption' })
  unlike(@CurrentUser() user: User, @Body() dto: LikeCaptionDto) {
    return this.captionsService.unlike(dto.id, user.id);
  }

  @Post('view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Record a view (fire-and-forget, deduplicated per hour)' })
  async view(@CurrentUser() user: User, @Body() dto: ViewCaptionDto) {
    // Intentionally do not await or surface errors
    this.captionsService.recordView(dto.id, user.id).catch(() => null);
  }

  @Post('report')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Report an inappropriate caption' })
  report(@CurrentUser() user: User, @Body() dto: ReportCaptionDto) {
    return this.captionsService.report(user.id, dto);
  }

  @Get('search')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Full-text search captions' })
  @ApiQuery({ name: 'q', description: 'Search query', example: 'when monday' })
  search(
    @CurrentUser() user: User | undefined,
    @Query('q') q: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.captionsService.search(q, pagination, user?.id);
  }

  @Get('trend-topics')
  @Public()
  @ApiOperation({ summary: 'Get 8 trending hashtags from the last 48 hours' })
  trendTopics() {
    return this.captionsService.getTrendingTopics();
  }

  @Get('popular')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Most liked captions by timeframe' })
  @ApiQuery({ name: 'timeframe', enum: ['day', 'week', 'month'], required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  popular(
    @CurrentUser() user: User | undefined,
    @Query('timeframe') timeframe: 'day' | 'week' | 'month' = 'week',
    @Query() pagination: PaginationDto,
  ) {
    return this.captionsService.getPopular(timeframe, pagination, user?.id);
  }

  // ─── Dynamic routes (/: id) AFTER specific routes ────────────────────────────

  @Get(':id')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get a single caption with meme and user details' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User | undefined,
  ) {
    return this.captionsService.findById(id, user?.id);
  }

  @Delete(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete your own caption' })
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.captionsService.delete(id, user.id);
  }

  @Get(':id/likes')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'List users who liked this caption (with is_following)' })
  @ApiQuery({ name: 'q', required: false, description: 'Filter by username' })
  getLikes(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User | undefined,
    @Query('q') q: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.captionsService.getLikes(id, user?.id, q, pagination);
  }
}
