import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiQuery,
} from '@nestjs/swagger';

import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ReportUserDto } from './dto/report-user.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { User } from '@prisma/client';

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ─── Specific routes BEFORE /:username ───────────────────────────────────────

  @Get('search')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Search users by username or display name' })
  @ApiQuery({ name: 'q', description: 'Search query', example: 'john' })
  search(
    @CurrentUser() user: User | undefined,
    @Query('q') q: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.usersService.searchUsers(q, pagination, user?.id);
  }

  @Post('report')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Report a user' })
  report(@CurrentUser() user: User, @Body() dto: ReportUserDto) {
    return this.usersService.reportUser(user.id, dto);
  }

  @Patch('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update own profile' })
  updateProfile(@CurrentUser() user: User, @Body() dto: UpdateUserDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Post('me/avatar')
  @ApiBearerAuth('access-token')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_SIZE } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload avatar photo' })
  uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_AVATAR_SIZE }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.usersService.uploadAvatar(user.id, file);
  }

  @Get('suggested')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get suggested users to follow (20 results, 2nd degree + popular)' })
  getSuggested(@CurrentUser() user: User) {
    return this.usersService.getSuggestedUsers(user.id);
  }

  // ─── Dynamic /:username routes ────────────────────────────────────────────────

  @Get(':username')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get public user profile with stats and social status' })
  getProfile(
    @Param('username') username: string,
    @CurrentUser() user: User | undefined,
  ) {
    return this.usersService.findByUsername(username, user?.id);
  }

  @Get(':username/captions')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Get user's captions (newest first)" })
  getUserCaptions(
    @Param('username') username: string,
    @Query() pagination: PaginationDto,
    @CurrentUser() user: User | undefined,
  ) {
    return this.usersService.getUserCaptions(username, pagination, user?.id);
  }

  @Get(':username/likes')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get captions the user has liked' })
  getUserLikes(
    @Param('username') username: string,
    @Query() pagination: PaginationDto,
    @CurrentUser() user: User | undefined,
  ) {
    return this.usersService.getUserLikes(username, pagination, user?.id);
  }

  @Get(':username/followers')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Get user's followers" })
  @ApiQuery({ name: 'q', required: false, description: 'Filter by username' })
  getFollowers(
    @Param('username') username: string,
    @Query() pagination: PaginationDto,
    @Query('q') q: string,
    @CurrentUser() user: User | undefined,
  ) {
    return this.usersService.getFollowers(username, pagination, q, user?.id);
  }

  @Get(':username/followings')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get users that this user follows' })
  @ApiQuery({ name: 'q', required: false, description: 'Filter by username' })
  getFollowings(
    @Param('username') username: string,
    @Query() pagination: PaginationDto,
    @Query('q') q: string,
    @CurrentUser() user: User | undefined,
  ) {
    return this.usersService.getFollowing(username, pagination, q, user?.id);
  }

  @Post(':username/follow')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Follow a user' })
  follow(@CurrentUser() user: User, @Param('username') username: string) {
    return this.usersService.follow(user.id, username);
  }

  @Delete(':username/follow')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Unfollow a user' })
  unfollow(@CurrentUser() user: User, @Param('username') username: string) {
    return this.usersService.unfollow(user.id, username);
  }

  @Post(':username/block')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Block a user (auto-unfollows both sides)' })
  block(@CurrentUser() user: User, @Param('username') username: string) {
    return this.usersService.block(user.id, username);
  }

  @Delete(':username/block')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Unblock a user' })
  unblock(@CurrentUser() user: User, @Param('username') username: string) {
    return this.usersService.unblock(user.id, username);
  }
}
