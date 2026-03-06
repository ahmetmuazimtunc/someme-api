import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { TagsService } from '../tags/tags.service';
import { CreateCaptionDto } from './dto/create-caption.dto';
import { ReportCaptionDto } from './dto/report-caption.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { calculateRank, LIKE_RANK_DELTA, VIEW_RANK_DELTA } from '../common/utils/ranking.util';

const SAFE_USER = {
  id: true,
  username: true,
  displayName: true,
  photoUrl: true,
  isVerified: true,
};

/** Captions with this many reports are hidden from public views */
const REPORT_HIDE_THRESHOLD = 5;

const POPULAR_CACHE_TTL = 3600; // 1 hour

@Injectable()
export class CaptionsService {
  private readonly logger = new Logger(CaptionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly tagsService: TagsService,
  ) {}

  // ─── Create ──────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateCaptionDto) {
    const meme = await this.db.meme.findUnique({
      where: { id: dto.meme_id, isActive: true },
    });
    if (!meme) throw new NotFoundException('Meme not found');

    const now = new Date();
    const initialRank = calculateRank(0, 0, now);

    const [caption] = await Promise.all([
      this.db.caption.create({
        data: {
          text: dto.text,
          language: dto.language ?? 'en',
          memeId: dto.meme_id,
          userId,
          rank: initialRank,
        },
        include: {
          user: { select: SAFE_USER },
          _count: { select: { likes: true } },
        },
      }),
      this.db.meme.update({
        where: { id: dto.meme_id },
        data: { captionCount: { increment: 1 } },
      }),
      this.redis.del(`meme:${dto.meme_id}`),
    ]);

    // Process hashtags asynchronously (fire and forget)
    this.tagsService.processTagsForCaption(caption.id, dto.text).catch(() => null);

    return { ...caption, is_liked: false };
  }

  // ─── Get Single Caption ───────────────────────────────────────────────────────

  async findById(captionId: string, userId?: string) {
    const caption = await this.db.caption.findUnique({
      where: { id: captionId, isActive: true, reportCount: { lt: REPORT_HIDE_THRESHOLD } },
      include: {
        user: { select: SAFE_USER },
        meme: true,
        _count: { select: { likes: true } },
        tags: { include: { tag: { select: { name: true, count: true } } } },
      },
    });

    if (!caption) throw new NotFoundException('Caption not found');

    let is_liked = false;
    if (userId) {
      const like = await this.db.like.findUnique({
        where: { userId_captionId: { userId, captionId } },
      });
      is_liked = !!like;
    }

    return { ...caption, is_liked };
  }

  // ─── Delete ───────────────────────────────────────────────────────────────────

  async delete(captionId: string, userId: string) {
    const caption = await this.db.caption.findUnique({
      where: { id: captionId },
    });

    if (!caption || !caption.isActive) throw new NotFoundException('Caption not found');
    if (caption.userId !== userId) throw new ForbiddenException('Not your caption');

    await Promise.all([
      this.db.caption.update({ where: { id: captionId }, data: { isActive: false } }),
      this.db.meme.update({
        where: { id: caption.memeId },
        data: { captionCount: { decrement: 1 } },
      }),
      this.redis.del(`meme:${caption.memeId}`),
    ]);

    // Decrement tag counts asynchronously
    this.tagsService.removeTagsForCaption(captionId).catch(() => null);

    return { deleted: true };
  }

  // ─── Like ─────────────────────────────────────────────────────────────────────

  async like(captionId: string, userId: string) {
    const caption = await this.db.caption.findUnique({
      where: { id: captionId, isActive: true },
    });
    if (!caption) throw new NotFoundException('Caption not found');

    const existing = await this.db.like.findUnique({
      where: { userId_captionId: { userId, captionId } },
    });
    if (existing) throw new ConflictException('Already liked');

    const [updatedCaption] = await Promise.all([
      this.db.caption.update({
        where: { id: captionId },
        data: {
          likesCount: { increment: 1 },
          rank: { increment: LIKE_RANK_DELTA },
        },
        include: { user: { select: SAFE_USER }, _count: { select: { likes: true } } },
      }),
      this.db.like.create({ data: { userId, captionId } }),
    ]);

    // Notify caption owner (fire and forget)
    if (caption.userId !== userId) {
      this.db.notification
        .create({ data: { type: 'LIKE', userId: caption.userId, actorId: userId, captionId } })
        .catch(() => null);
    }

    return { ...updatedCaption, is_liked: true };
  }

  // ─── Unlike ───────────────────────────────────────────────────────────────────

  async unlike(captionId: string, userId: string) {
    const existing = await this.db.like.findUnique({
      where: { userId_captionId: { userId, captionId } },
    });
    if (!existing) throw new NotFoundException('Like not found');

    const [updatedCaption] = await Promise.all([
      this.db.caption.update({
        where: { id: captionId },
        data: {
          likesCount: { decrement: 1 },
          rank: { decrement: LIKE_RANK_DELTA },
        },
        include: { user: { select: SAFE_USER }, _count: { select: { likes: true } } },
      }),
      this.db.like.delete({ where: { userId_captionId: { userId, captionId } } }),
    ]);

    return { ...updatedCaption, is_liked: false };
  }

  // ─── View (fire and forget) ───────────────────────────────────────────────────

  async recordView(captionId: string, userId: string): Promise<void> {
    const cacheKey = `view:${userId}:${captionId}`;

    // Deduplicate: only count 1 view per user per caption per hour
    const alreadyViewed = await this.redis.exists(cacheKey);
    if (alreadyViewed) return;

    await Promise.all([
      this.db.caption
        .update({
          where: { id: captionId },
          data: { viewsCount: { increment: 1 }, rank: { increment: VIEW_RANK_DELTA } },
        })
        .catch(() => null),
      this.redis.set(cacheKey, '1', 3600),
    ]);
  }

  // ─── Get Likes (who liked this caption) ──────────────────────────────────────

  async getLikes(captionId: string, userId?: string, query?: string, pagination?: PaginationDto) {
    const page = pagination ?? { skip: 0, limit: 20, page: 1 };

    const where = {
      captionId,
      ...(query && {
        user: { username: { contains: query, mode: 'insensitive' as const } },
      }),
    };

    const [likes, total] = await Promise.all([
      this.db.like.findMany({
        where,
        include: { user: { select: SAFE_USER } },
        skip: page.skip,
        take: page.limit ?? 20,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.like.count({ where }),
    ]);

    const users = likes.map((l) => l.user);

    if (userId && users.length) {
      const followingRows = await this.db.follow.findMany({
        where: { followerId: userId, followingId: { in: users.map((u) => u.id) } },
        select: { followingId: true },
      });
      const followingSet = new Set(followingRows.map((f) => f.followingId));

      return {
        data: users.map((u) => ({ ...u, is_following: followingSet.has(u.id) })),
        total,
        page: page.page,
        limit: page.limit,
      };
    }

    return {
      data: users.map((u) => ({ ...u, is_following: false })),
      total,
      page: page.page,
      limit: page.limit,
    };
  }

  // ─── Search ───────────────────────────────────────────────────────────────────

  async search(query: string, pagination: PaginationDto, userId?: string) {
    if (!query?.trim()) return { data: [], total: 0 };

    const where = {
      isActive: true,
      reportCount: { lt: REPORT_HIDE_THRESHOLD },
      text: { contains: query.trim(), mode: 'insensitive' as const },
    };

    const [captions, total] = await Promise.all([
      this.db.caption.findMany({
        where,
        include: {
          user: { select: SAFE_USER },
          meme: { select: { id: true, thumbnailUrl: true, imageUrl: true, width: true, height: true } },
          _count: { select: { likes: true } },
        },
        orderBy: [{ rank: 'desc' }, { likesCount: 'desc' }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.db.caption.count({ where }),
    ]);

    if (userId) {
      const likedSet = await this.getLikedSet(captions.map((c) => c.id), userId);
      return {
        data: captions.map((c) => ({ ...c, is_liked: likedSet.has(c.id) })),
        total,
        page: pagination.page,
        limit: pagination.limit,
      };
    }

    return { data: captions.map((c) => ({ ...c, is_liked: false })), total, page: pagination.page, limit: pagination.limit };
  }

  // ─── Popular Captions ────────────────────────────────────────────────────────

  async getPopular(timeframe: 'day' | 'week' | 'month', pagination: PaginationDto, userId?: string) {
    const cacheKey = `popular:captions:${timeframe}:${pagination.page}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      // Enrich is_liked on cached data if user is logged in
      if (userId && data.data?.length) {
        const likedSet = await this.getLikedSet(data.data.map((c: any) => c.id), userId);
        return { ...data, data: data.data.map((c: any) => ({ ...c, is_liked: likedSet.has(c.id) })) };
      }
      return data;
    }

    const hoursMap = { day: 24, week: 168, month: 720 };
    const since = new Date(Date.now() - hoursMap[timeframe] * 3_600_000);

    const where = {
      isActive: true,
      reportCount: { lt: REPORT_HIDE_THRESHOLD },
      createdAt: { gte: since },
    };

    const [captions, total] = await Promise.all([
      this.db.caption.findMany({
        where,
        include: {
          user: { select: SAFE_USER },
          meme: { select: { id: true, thumbnailUrl: true, imageUrl: true, width: true, height: true } },
          _count: { select: { likes: true } },
        },
        orderBy: { likesCount: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.db.caption.count({ where }),
    ]);

    const result = {
      data: captions.map((c) => ({ ...c, is_liked: false })),
      total,
      page: pagination.page,
      limit: pagination.limit,
    };

    await this.redis.set(cacheKey, JSON.stringify(result), POPULAR_CACHE_TTL);

    if (userId && captions.length) {
      const likedSet = await this.getLikedSet(captions.map((c) => c.id), userId);
      return { ...result, data: result.data.map((c) => ({ ...c, is_liked: likedSet.has(c.id) })) };
    }

    return result;
  }

  // ─── Report ───────────────────────────────────────────────────────────────────

  async report(userId: string, dto: ReportCaptionDto) {
    const caption = await this.db.caption.findUnique({
      where: { id: dto.caption_id, isActive: true },
    });
    if (!caption) throw new NotFoundException('Caption not found');

    const existing = await this.db.report.findFirst({
      where: { userId, captionId: dto.caption_id },
    });
    if (existing) throw new ConflictException('You already reported this caption');

    await Promise.all([
      this.db.report.create({
        data: {
          captionId: dto.caption_id,
          userId,
          reason: dto.reason,
          description: dto.description,
        },
      }),
      this.db.caption.update({
        where: { id: dto.caption_id },
        data: { reportCount: { increment: 1 } },
      }),
    ]);

    this.logger.warn(`Caption ${dto.caption_id} reported by ${userId} — reason: ${dto.reason}`);

    return { reported: true, message: 'Thank you for your report. We will review it shortly.' };
  }

  // ─── Trending Topics (legacy — delegates to TagsService) ─────────────────────

  async getTrendingTopics(): Promise<string[]> {
    // Legacy endpoint kept for backwards compatibility; returns tag names without #
    const cacheKey = 'trending:topics';
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const since = new Date(Date.now() - 48 * 3_600_000);

    const recentCaptions = await this.db.caption.findMany({
      where: { isActive: true, createdAt: { gte: since } },
      select: { text: true },
      orderBy: { likesCount: 'desc' },
      take: 2000,
    });

    const hashtagCount: Record<string, number> = {};
    for (const { text } of recentCaptions) {
      const tags = text.match(/#[a-zA-Z0-9_]+/g) ?? [];
      for (const tag of tags) {
        const lower = tag.toLowerCase();
        hashtagCount[lower] = (hashtagCount[lower] ?? 0) + 1;
      }
    }

    const trending = Object.entries(hashtagCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([tag]) => tag);

    await this.redis.set(cacheKey, JSON.stringify(trending), 900);
    return trending;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async getLikedSet(captionIds: string[], userId: string): Promise<Set<string>> {
    if (!captionIds.length) return new Set();
    const likes = await this.db.like.findMany({
      where: { userId, captionId: { in: captionIds } },
      select: { captionId: true },
    });
    return new Set(likes.map((l) => l.captionId));
  }
}
