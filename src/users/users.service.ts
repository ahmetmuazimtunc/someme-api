import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { RedisService } from '../redis/redis.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ReportUserDto } from './dto/report-user.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

const PROFILE_CACHE_TTL = 300; // 5 minutes

const SAFE_USER = {
  id: true,
  username: true,
  displayName: true,
  photoUrl: true,
  isVerified: true,
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
  ) {}

  // ─── Profile ─────────────────────────────────────────────────────────────────

  async findByUsername(username: string, currentUserId?: string) {
    const user = await this.db.user.findUnique({
      where: { username: username.toLowerCase(), isActive: true },
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
        photoUrl: true,
        isVerified: true,
        contentLanguages: true,
        socialProvider: true,
        createdAt: true,
        _count: {
          select: {
            followers: true,
            following: true,
            captions: { where: { isActive: true } },
          },
        },
      },
    });

    if (!user) throw new NotFoundException(`User @${username} not found`);

    // Calculate total likes received on their captions
    const likesCount = await this.db.like.count({
      where: { caption: { userId: user.id, isActive: true } },
    });

    const profile = {
      ...user,
      stats: {
        captions_count: user._count.captions,
        likes_count: likesCount,
        followers_count: user._count.followers,
        following_count: user._count.following,
      },
      is_following: false,
      is_follower: false,
      is_blocked: false,
      is_blocked_by: false,
    };
    delete (profile as Record<string, unknown>)['_count'];

    if (currentUserId && currentUserId !== user.id) {
      const [following, follower, blocked, blockedBy] = await Promise.all([
        this.db.follow.findUnique({
          where: { followerId_followingId: { followerId: currentUserId, followingId: user.id } },
        }),
        this.db.follow.findUnique({
          where: { followerId_followingId: { followerId: user.id, followingId: currentUserId } },
        }),
        this.db.block.findUnique({
          where: { blockerId_blockedId: { blockerId: currentUserId, blockedId: user.id } },
        }),
        this.db.block.findUnique({
          where: { blockerId_blockedId: { blockerId: user.id, blockedId: currentUserId } },
        }),
      ]);

      profile.is_following = !!following;
      profile.is_follower = !!follower;
      profile.is_blocked = !!blocked;
      profile.is_blocked_by = !!blockedBy;
    }

    return profile;
  }

  // ─── User's Captions ─────────────────────────────────────────────────────────

  async getUserCaptions(username: string, pagination: PaginationDto, currentUserId?: string) {
    const user = await this.requireUser(username);

    const [captions, total] = await Promise.all([
      this.db.caption.findMany({
        where: { userId: user.id, isActive: true },
        include: {
          meme: {
            select: { id: true, imageUrl: true, thumbnailUrl: true, width: true, height: true },
          },
          _count: { select: { likes: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.db.caption.count({ where: { userId: user.id, isActive: true } }),
    ]);

    if (currentUserId && captions.length) {
      const likedRows = await this.db.like.findMany({
        where: { userId: currentUserId, captionId: { in: captions.map((c) => c.id) } },
        select: { captionId: true },
      });
      const likedSet = new Set(likedRows.map((l) => l.captionId));
      return {
        data: captions.map((c) => ({ ...c, is_liked: likedSet.has(c.id) })),
        total,
        page: pagination.page,
        limit: pagination.limit,
      };
    }

    return {
      data: captions.map((c) => ({ ...c, is_liked: false })),
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  // ─── User's Liked Captions ────────────────────────────────────────────────────

  async getUserLikes(username: string, pagination: PaginationDto, currentUserId?: string) {
    const user = await this.requireUser(username);

    const [likes, total] = await Promise.all([
      this.db.like.findMany({
        where: { userId: user.id },
        include: {
          caption: {
            include: {
              user: { select: SAFE_USER },
              meme: {
                select: { id: true, imageUrl: true, thumbnailUrl: true, width: true, height: true },
              },
              _count: { select: { likes: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.db.like.count({ where: { userId: user.id } }),
    ]);

    const captions = likes.map((l) => l.caption).filter((c) => c.isActive);

    if (currentUserId && captions.length) {
      const likedRows = await this.db.like.findMany({
        where: { userId: currentUserId, captionId: { in: captions.map((c) => c.id) } },
        select: { captionId: true },
      });
      const likedSet = new Set(likedRows.map((l) => l.captionId));
      return {
        data: captions.map((c) => ({ ...c, is_liked: likedSet.has(c.id) })),
        total,
        page: pagination.page,
        limit: pagination.limit,
      };
    }

    return {
      data: captions.map((c) => ({ ...c, is_liked: false })),
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  // ─── Followers / Following ────────────────────────────────────────────────────

  async getFollowers(
    username: string,
    pagination: PaginationDto,
    query?: string,
    currentUserId?: string,
  ) {
    const user = await this.requireUser(username);

    const where = {
      followingId: user.id,
      ...(query && {
        follower: { username: { contains: query, mode: 'insensitive' as const } },
      }),
    };

    const [rows, total] = await Promise.all([
      this.db.follow.findMany({
        where,
        include: { follower: { select: SAFE_USER } },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.follow.count({ where }),
    ]);

    const users = rows.map((r) => r.follower);
    return {
      data: await this.enrichWithFollowingStatus(users, currentUserId),
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  async getFollowing(
    username: string,
    pagination: PaginationDto,
    query?: string,
    currentUserId?: string,
  ) {
    const user = await this.requireUser(username);

    const where = {
      followerId: user.id,
      ...(query && {
        following: { username: { contains: query, mode: 'insensitive' as const } },
      }),
    };

    const [rows, total] = await Promise.all([
      this.db.follow.findMany({
        where,
        include: { following: { select: SAFE_USER } },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.follow.count({ where }),
    ]);

    const users = rows.map((r) => r.following);
    return {
      data: await this.enrichWithFollowingStatus(users, currentUserId),
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  // ─── Search Users ─────────────────────────────────────────────────────────────

  async searchUsers(query: string, pagination: PaginationDto, currentUserId?: string) {
    if (!query?.trim()) return { data: [], total: 0 };

    const where = {
      isActive: true,
      OR: [
        { username: { contains: query.trim(), mode: 'insensitive' as const } },
        { displayName: { contains: query.trim(), mode: 'insensitive' as const } },
      ],
    };

    const [users, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: {
          ...SAFE_USER,
          _count: { select: { followers: true } },
        },
        orderBy: [{ isVerified: 'desc' }, { createdAt: 'asc' }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.db.user.count({ where }),
    ]);

    const enriched = await this.enrichWithFollowingStatus(
      users.map((u) => ({ ...u, followersCount: u._count.followers })),
      currentUserId,
    );

    return { data: enriched, total, page: pagination.page, limit: pagination.limit };
  }

  // ─── Update Profile ───────────────────────────────────────────────────────────

  async updateProfile(userId: string, dto: UpdateUserDto) {
    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.birthday && { birthday: new Date(dto.birthday) }),
      },
      select: {
        id: true, username: true, displayName: true, bio: true,
        photoUrl: true, isVerified: true, contentLanguages: true, createdAt: true,
      },
    });

    await this.redis.del(`profile:${updated.username}`);
    return updated;
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const result = await this.storage.uploadFile(file, 'avatars');
    const updated = await this.db.user.update({
      where: { id: userId },
      data: { photoUrl: result.url },
      select: { id: true, photoUrl: true },
    });
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { username: true } });
    if (user) await this.redis.del(`profile:${user.username}`);
    return updated;
  }

  // ─── Follow System ────────────────────────────────────────────────────────────

  async follow(followerId: string, targetUsername: string) {
    const target = await this.requireUser(targetUsername);

    if (target.id === followerId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    // Block checks
    const [blockedByTarget, blockedTarget] = await Promise.all([
      this.db.block.findUnique({
        where: { blockerId_blockedId: { blockerId: target.id, blockedId: followerId } },
      }),
      this.db.block.findUnique({
        where: { blockerId_blockedId: { blockerId: followerId, blockedId: target.id } },
      }),
    ]);

    if (blockedByTarget) throw new ForbiddenException('You cannot follow this user');
    if (blockedTarget) throw new ForbiddenException('Unblock this user before following');

    const existing = await this.db.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId: target.id } },
    });
    if (existing) throw new ConflictException('Already following this user');

    await this.db.follow.create({ data: { followerId, followingId: target.id } });

    // Notify target (fire and forget)
    this.db.notification
      .create({ data: { type: 'FOLLOW', userId: target.id, actorId: followerId } })
      .catch(() => null);

    await this.redis.del(`profile:${targetUsername}`);
    return { following: true };
  }

  async unfollow(followerId: string, targetUsername: string) {
    const target = await this.requireUser(targetUsername);

    await this.db.follow.deleteMany({
      where: { followerId, followingId: target.id },
    });

    await this.redis.del(`profile:${targetUsername}`);
    return { following: false };
  }

  // ─── Block System ─────────────────────────────────────────────────────────────

  async block(blockerId: string, targetUsername: string) {
    const target = await this.requireUser(targetUsername);

    if (target.id === blockerId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const existing = await this.db.block.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId: target.id } },
    });
    if (existing) throw new ConflictException('User is already blocked');

    // Auto-unfollow each other when blocking
    await Promise.all([
      this.db.block.create({ data: { blockerId, blockedId: target.id } }),
      this.db.follow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: target.id },
            { followerId: target.id, followingId: blockerId },
          ],
        },
      }),
    ]);

    this.logger.log(`User ${blockerId} blocked @${targetUsername}`);
    return { blocked: true };
  }

  async unblock(blockerId: string, targetUsername: string) {
    const target = await this.requireUser(targetUsername);

    await this.db.block.deleteMany({
      where: { blockerId, blockedId: target.id },
    });

    return { blocked: false };
  }

  async getBlockedUsers(userId: string, pagination: PaginationDto) {
    const [rows, total] = await Promise.all([
      this.db.block.findMany({
        where: { blockerId: userId },
        include: { blocked: { select: SAFE_USER } },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.block.count({ where: { blockerId: userId } }),
    ]);

    return {
      data: rows.map((r) => r.blocked),
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  // ─── Report User ──────────────────────────────────────────────────────────────

  async reportUser(reporterId: string, dto: ReportUserDto) {
    const target = await this.requireUser(dto.username);

    if (target.id === reporterId) {
      throw new BadRequestException('You cannot report yourself');
    }

    const existing = await this.db.userReport.findFirst({
      where: { reporterId, userId: target.id },
    });
    if (existing) throw new ConflictException('You have already reported this user');

    await this.db.userReport.create({
      data: {
        reporterId,
        userId: target.id,
        reason: dto.reason,
        description: dto.description,
      },
    });

    this.logger.warn(`User ${target.username} reported by ${reporterId} — reason: ${dto.reason}`);
    return { reported: true, message: 'Thank you for your report. We will review it shortly.' };
  }

  // ─── Suggested Users ─────────────────────────────────────────────────────────

  async getSuggestedUsers(userId: string) {
    const blockedIds = await this.getBlockedUserIds(userId);

    // Users already followed by the current user
    const following = await this.db.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const followingIds = following.map((f) => f.followingId);

    // Get IDs followed by people I follow (2nd degree)
    const secondDegree =
      followingIds.length > 0
        ? await this.db.follow.findMany({
            where: {
              followerId: { in: followingIds },
              followingId: {
                notIn: [userId, ...followingIds, ...blockedIds],
              },
            },
            select: { followingId: true },
            take: 100,
          })
        : [];

    const secondDegreeIds = [...new Set(secondDegree.map((r) => r.followingId))];

    // Fetch 2nd-degree suggestions first, fill with popular users if needed
    const excluded = [userId, ...followingIds, ...blockedIds];

    const secondDegreeSuggestions = secondDegreeIds.length
      ? await this.db.user.findMany({
          where: { id: { in: secondDegreeIds }, isActive: true },
          select: {
            ...SAFE_USER,
            contentLanguages: true,
            _count: { select: { followers: true } },
          },
          orderBy: { followers: { _count: 'desc' } },
          take: 20,
        })
      : [];

    let suggestions = secondDegreeSuggestions;

    if (suggestions.length < 20) {
      const popular = await this.db.user.findMany({
        where: {
          id: { notIn: [...excluded, ...suggestions.map((u) => u.id)] },
          isActive: true,
        },
        select: {
          ...SAFE_USER,
          contentLanguages: true,
          _count: { select: { followers: true } },
        },
        orderBy: { followers: { _count: 'desc' } },
        take: 20 - suggestions.length,
      });
      suggestions = [...suggestions, ...popular];
    }

    return suggestions.map((u) => ({
      ...u,
      followers_count: u._count.followers,
      is_following: false,
      _count: undefined,
    }));
  }

  // ─── Helper: Get blocked user IDs (for feed filtering) ───────────────────────

  async getBlockedUserIds(userId: string): Promise<string[]> {
    const cacheKey = `blocked_ids:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const [blocking, blockedBy] = await Promise.all([
      this.db.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
      this.db.block.findMany({ where: { blockedId: userId }, select: { blockerId: true } }),
    ]);

    const ids = [
      ...blocking.map((b) => b.blockedId),
      ...blockedBy.map((b) => b.blockerId),
    ];

    await this.redis.set(cacheKey, JSON.stringify(ids), 300);
    return ids;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async requireUser(username: string) {
    const user = await this.db.user.findUnique({
      where: { username: username.toLowerCase(), isActive: true },
      select: { id: true, username: true },
    });
    if (!user) throw new NotFoundException(`User @${username} not found`);
    return user;
  }

  private async enrichWithFollowingStatus<T extends { id: string }>(
    users: T[],
    currentUserId?: string,
  ): Promise<(T & { is_following: boolean })[]> {
    if (!currentUserId || !users.length) {
      return users.map((u) => ({ ...u, is_following: false }));
    }

    const followingRows = await this.db.follow.findMany({
      where: { followerId: currentUserId, followingId: { in: users.map((u) => u.id) } },
      select: { followingId: true },
    });
    const followingSet = new Set(followingRows.map((f) => f.followingId));

    return users.map((u) => ({ ...u, is_following: followingSet.has(u.id) }));
  }
}
