import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import * as sharp from 'sharp';

import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ExploreFeedDto } from './dto/explore-feed.dto';
import { MemeCaptionsQueryDto, CaptionOrder } from './dto/meme-captions-query.dto';

const MEME_CACHE_TTL = 300;
const EXPLORE_POOL_SIZE = 60;
const FEED_PAGE_SIZE = 10;
const TOP_CAPTIONS_PER_MEME = 3;
const TRENDING_CACHE_TTL = 1800; // 30 minutes
const REPORT_HIDE_THRESHOLD = 5;

const SAFE_USER = {
  id: true,
  username: true,
  displayName: true,
  photoUrl: true,
  isVerified: true,
};

const CAPTION_INCLUDE = () => ({
  user: { select: SAFE_USER },
  _count: { select: { likes: true } },
});

@Injectable()
export class MemesService {
  private readonly logger = new Logger(MemesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly usersService: UsersService,
  ) {}

  // ─── Upload ──────────────────────────────────────────────────────────────────

  async uploadMeme(userId: string, file: Express.Multer.File) {
    const metadata = await sharp(file.buffer).metadata();

    const [original, thumbnail] = await Promise.all([
      this.storage.uploadFile(file, 'memes'),
      this.createThumbnail(file),
    ]);

    return this.db.meme.create({
      data: {
        imageUrl: original.url,
        thumbnailUrl: thumbnail.url,
        storageKey: original.key,
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
    });
  }

  // ─── Single Meme ─────────────────────────────────────────────────────────────

  async findById(memeId: string) {
    const cached = await this.redis.get(`meme:${memeId}`);
    if (cached) return JSON.parse(cached);

    const meme = await this.db.meme.findUnique({
      where: { id: memeId, isActive: true },
      include: { _count: { select: { captions: true } } },
    });

    if (!meme) throw new NotFoundException('Meme not found');

    await this.redis.set(`meme:${memeId}`, JSON.stringify(meme), MEME_CACHE_TTL);
    return meme;
  }

  // ─── Meme Captions ───────────────────────────────────────────────────────────

  async getMemeCaptions(memeId: string, query: MemeCaptionsQueryDto, userId?: string) {
    const meme = await this.db.meme.findUnique({ where: { id: memeId, isActive: true } });
    if (!meme) throw new NotFoundException('Meme not found');

    const blockedIds = userId ? await this.usersService.getBlockedUserIds(userId) : [];

    const where = {
      memeId,
      isActive: true,
      reportCount: { lt: REPORT_HIDE_THRESHOLD },
      ...(blockedIds.length && { userId: { notIn: blockedIds } }),
      ...(query.language && { language: query.language }),
    };

    const orderBy = this.resolveCaptionOrder(query.order);

    const [captions, total] = await Promise.all([
      this.db.caption.findMany({
        where,
        include: CAPTION_INCLUDE(),
        orderBy,
        skip: query.skip,
        take: query.limit,
      }),
      this.db.caption.count({ where }),
    ]);

    const enriched = await this.enrichCaptionsWithLiked(captions, userId);
    return { data: enriched, total, page: query.page, limit: query.limit };
  }

  // ─── Explore (random unseen memes) ───────────────────────────────────────────

  async explore(dto: ExploreFeedDto, userId?: string) {
    const excepts = dto.excepts ?? [];
    const blockedIds = userId ? await this.usersService.getBlockedUserIds(userId) : [];

    const captionWhere = {
      isActive: true,
      reportCount: { lt: REPORT_HIDE_THRESHOLD },
      ...(blockedIds.length && { userId: { notIn: blockedIds } }),
    };

    const pool = await this.db.meme.findMany({
      where: {
        isActive: true,
        id: { notIn: excepts },
        ...(blockedIds.length && {
          captions: { none: { userId: { in: blockedIds } } },
        }),
      },
      select: { id: true },
      orderBy: { captionCount: 'desc' },
      take: EXPLORE_POOL_SIZE,
    });

    const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, FEED_PAGE_SIZE);
    const memeIds = shuffled.map((m) => m.id);

    const memes = await this.db.meme.findMany({
      where: { id: { in: memeIds } },
      include: {
        _count: { select: { captions: true } },
        captions: {
          where: captionWhere,
          orderBy: { rank: 'desc' },
          take: TOP_CAPTIONS_PER_MEME,
          include: CAPTION_INCLUDE(),
        },
      },
    });

    const captionIds = memes.flatMap((m) => m.captions.map((c) => c.id));
    const likedSet = await this.getLikedSet(captionIds, userId);

    return memes.map((meme) => ({
      ...meme,
      captions: meme.captions.map((c) => ({ ...c, is_liked: likedSet.has(c.id) })),
    }));
  }

  // ─── Search ───────────────────────────────────────────────────────────────────

  async search(query: string, pagination: PaginationDto) {
    if (!query?.trim()) return { data: [], total: 0 };

    const [captions, total] = await Promise.all([
      this.db.caption.findMany({
        where: {
          isActive: true,
          reportCount: { lt: REPORT_HIDE_THRESHOLD },
          text: { contains: query.trim(), mode: 'insensitive' },
        },
        distinct: ['memeId'],
        include: {
          meme: true,
          user: { select: SAFE_USER },
          _count: { select: { likes: true } },
        },
        orderBy: [{ rank: 'desc' }, { likesCount: 'desc' }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.db.caption.count({
        where: {
          isActive: true,
          reportCount: { lt: REPORT_HIDE_THRESHOLD },
          text: { contains: query.trim(), mode: 'insensitive' },
        },
      }),
    ]);

    return { data: captions, total, page: pagination.page, limit: pagination.limit };
  }

  // ─── Trending Memes ───────────────────────────────────────────────────────────

  async getTrending(pagination: PaginationDto, userId?: string) {
    const cacheKey = `trending:memes:${pagination.page}`;
    const cached = await this.redis.get(cacheKey);

    let memeData: any[];
    let total: number;

    if (cached) {
      const data = JSON.parse(cached);
      memeData = data.data;
      total = data.total;
    } else {
      const since = new Date(Date.now() - 7 * 24 * 3_600_000);

      // Group captions created in the last 7 days by meme_id, count them
      const rows = await this.db.$queryRaw<Array<{ meme_id: string; caption_count: bigint }>>`
        SELECT meme_id, COUNT(*) AS caption_count
        FROM captions
        WHERE is_active = true
          AND created_at >= ${since}
        GROUP BY meme_id
        ORDER BY caption_count DESC
        LIMIT ${pagination.limit} OFFSET ${pagination.skip}
      `;

      const totalRows = await this.db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT meme_id) AS count
        FROM captions
        WHERE is_active = true AND created_at >= ${since}
      `;

      total = Number(totalRows[0]?.count ?? 0);
      const memeIds = rows.map((r) => r.meme_id);

      const memes = await this.db.meme.findMany({
        where: { id: { in: memeIds }, isActive: true },
        include: {
          _count: { select: { captions: true } },
          captions: {
            where: { isActive: true, reportCount: { lt: REPORT_HIDE_THRESHOLD } },
            orderBy: { rank: 'desc' },
            take: 1,
            include: CAPTION_INCLUDE(),
          },
        },
      });

      // Preserve ranking order from raw query
      const memeMap = new Map(memes.map((m) => [m.id, m]));
      memeData = memeIds.map((id) => memeMap.get(id)).filter(Boolean);

      const result = { data: memeData, total };
      await this.redis.set(cacheKey, JSON.stringify(result), TRENDING_CACHE_TTL);
    }

    // Enrich captions with is_liked
    if (userId) {
      const captionIds = memeData.flatMap((m: any) => (m.captions ?? []).map((c: any) => c.id));
      const likedSet = await this.getLikedSet(captionIds, userId);
      memeData = memeData.map((m: any) => ({
        ...m,
        captions: (m.captions ?? []).map((c: any) => ({ ...c, is_liked: likedSet.has(c.id) })),
      }));
    } else {
      memeData = memeData.map((m: any) => ({
        ...m,
        captions: (m.captions ?? []).map((c: any) => ({ ...c, is_liked: false })),
      }));
    }

    return { data: memeData, total, page: pagination.page, limit: pagination.limit };
  }

  // ─── Following Feed ───────────────────────────────────────────────────────────

  async getFollowingFeed(userId: string, dto: ExploreFeedDto) {
    const excepts = dto.excepts ?? [];
    const blockedIds = await this.usersService.getBlockedUserIds(userId);

    const following = await this.db.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });

    const followingIds = following.map((f) => f.followingId);

    if (followingIds.length === 0) {
      return this.explore(dto, userId);
    }

    const captions = await this.db.caption.findMany({
      where: {
        userId: { in: followingIds },
        memeId: { notIn: excepts },
        isActive: true,
        reportCount: { lt: REPORT_HIDE_THRESHOLD },
        ...(blockedIds.length && { userId: { notIn: blockedIds } }),
      },
      distinct: ['memeId'],
      orderBy: [{ rank: 'desc' }, { createdAt: 'desc' }],
      take: FEED_PAGE_SIZE,
      include: {
        meme: { include: { _count: { select: { captions: true } } } },
        user: { select: SAFE_USER },
        _count: { select: { likes: true } },
      },
    });

    const captionIds = captions.map((c) => c.id);
    const likedSet = await this.getLikedSet(captionIds, userId);

    return captions.map((c) => ({ ...c, is_liked: likedSet.has(c.id) }));
  }

  // ─── Explore Feed (algorithmic, with tag personalization) ─────────────────────

  async getExploreFeed(userId: string, dto: ExploreFeedDto) {
    const excepts = dto.excepts ?? [];
    const blockedIds = await this.usersService.getBlockedUserIds(userId);

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { contentLanguages: true },
    });

    const languages = user?.contentLanguages?.length ? user.contentLanguages : ['en'];

    // Get user's recently engaged tag IDs (tags from liked captions in last 30 days)
    const recentLikes = await this.db.like.findMany({
      where: { userId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3_600_000) } },
      select: { captionId: true },
      take: 50,
    });

    const userTagIds = recentLikes.length
      ? (
          await this.db.captionTag.findMany({
            where: { captionId: { in: recentLikes.map((l) => l.captionId) } },
            select: { tagId: true },
            distinct: ['tagId'],
          })
        ).map((r) => r.tagId)
      : [];

    const captionWhere = {
      memeId: { notIn: excepts },
      isActive: true,
      reportCount: { lt: REPORT_HIDE_THRESHOLD },
      language: { in: languages },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 3_600_000) },
      ...(blockedIds.length && { userId: { notIn: blockedIds } }),
    };

    let captions = await this.db.caption.findMany({
      where: captionWhere,
      distinct: ['memeId'],
      orderBy: [{ rank: 'desc' }, { likesCount: 'desc' }],
      take: FEED_PAGE_SIZE * 3, // overfetch for diversity filtering
      include: {
        meme: { include: { _count: { select: { captions: true } } } },
        user: { select: SAFE_USER },
        _count: { select: { likes: true } },
        tags: { select: { tagId: true } },
      },
    });

    // Apply diversity: no same creator twice, mix tag variety
    captions = this.applyDiversity(captions, userTagIds, FEED_PAGE_SIZE);

    // Backfill if still short
    if (captions.length < FEED_PAGE_SIZE) {
      const seenMemeIds = [...excepts, ...captions.map((c) => c.memeId)];
      const backfill = await this.db.caption.findMany({
        where: {
          memeId: { notIn: seenMemeIds },
          isActive: true,
          reportCount: { lt: REPORT_HIDE_THRESHOLD },
          createdAt: { gte: new Date(Date.now() - 14 * 24 * 3_600_000) },
          ...(blockedIds.length && { userId: { notIn: blockedIds } }),
        },
        distinct: ['memeId'],
        orderBy: { rank: 'desc' },
        take: FEED_PAGE_SIZE - captions.length,
        include: {
          meme: { include: { _count: { select: { captions: true } } } },
          user: { select: SAFE_USER },
          _count: { select: { likes: true } },
          tags: { select: { tagId: true } },
        },
      });
      captions.push(...backfill);
    }

    const captionIds = captions.map((c) => c.id);
    const likedSet = await this.getLikedSet(captionIds, userId);

    return captions.map((c) => ({ ...c, is_liked: likedSet.has(c.id) }));
  }

  // ─── Feed: More Captions for a Meme ──────────────────────────────────────────

  async getFeedMemeCaptions(memeId: string, query: MemeCaptionsQueryDto, userId?: string) {
    return this.getMemeCaptions(memeId, query, userId);
  }

  // ─── Delete ───────────────────────────────────────────────────────────────────

  async delete(memeId: string) {
    const meme = await this.db.meme.findUnique({ where: { id: memeId } });
    if (!meme) throw new NotFoundException('Meme not found');

    await Promise.all([
      this.db.meme.update({ where: { id: memeId }, data: { isActive: false } }),
      this.redis.del(`meme:${memeId}`),
    ]);

    return { deleted: true };
  }

  // ─── Private: Content Diversity ──────────────────────────────────────────────

  private applyDiversity(captions: any[], userTagIds: string[], limit: number): any[] {
    const seenCreators = new Set<string>();
    const usedTagIds = new Set<string>();
    const result: any[] = [];

    // First pass: prefer user's interested tags, one per creator
    for (const c of captions) {
      if (result.length >= limit) break;
      if (seenCreators.has(c.userId)) continue;

      const captionTagIds: string[] = (c.tags ?? []).map((t: any) => t.tagId);
      const isInteresting = userTagIds.some((tid) => captionTagIds.includes(tid));

      if (isInteresting || !userTagIds.length) {
        seenCreators.add(c.userId);
        captionTagIds.forEach((tid) => usedTagIds.add(tid));
        result.push(c);
      }
    }

    // Second pass: fill remaining slots with any creator not yet seen
    for (const c of captions) {
      if (result.length >= limit) break;
      if (seenCreators.has(c.userId)) continue;
      seenCreators.add(c.userId);
      result.push(c);
    }

    // Third pass: if still short, allow same creator
    for (const c of captions) {
      if (result.length >= limit) break;
      if (!result.includes(c)) result.push(c);
    }

    return result.slice(0, limit);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async getLikedSet(captionIds: string[], userId?: string): Promise<Set<string>> {
    if (!userId || captionIds.length === 0) return new Set();

    const likes = await this.db.like.findMany({
      where: { userId, captionId: { in: captionIds } },
      select: { captionId: true },
    });

    return new Set(likes.map((l) => l.captionId));
  }

  private async enrichCaptionsWithLiked(captions: any[], userId?: string) {
    const likedSet = await this.getLikedSet(captions.map((c) => c.id), userId);
    return captions.map((c) => ({ ...c, is_liked: likedSet.has(c.id) }));
  }

  private resolveCaptionOrder(order?: CaptionOrder) {
    switch (order) {
      case CaptionOrder.RECENT:
        return { createdAt: 'desc' as const };
      case CaptionOrder.TOP:
        return { likesCount: 'desc' as const };
      default:
        return { rank: 'desc' as const };
    }
  }

  private async createThumbnail(file: Express.Multer.File) {
    const buffer = await sharp(file.buffer)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    return this.storage.uploadFile(
      { ...file, buffer, originalname: `thumb_${Date.now()}.jpg`, mimetype: 'image/jpeg' },
      'thumbnails',
    );
  }
}
