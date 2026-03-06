import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { PaginationDto } from '../common/dto/pagination.dto';

const TAG_SEARCH_CACHE_TTL = 60; // 1 minute
const TRENDING_CACHE_TTL = 1800; // 30 minutes
const TRENDING_WINDOW_H = 24;

const SAFE_USER = {
  id: true,
  username: true,
  displayName: true,
  photoUrl: true,
  isVerified: true,
};

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  // ─── Extract ─────────────────────────────────────────────────────────────────

  extractTags(text: string): string[] {
    const matches = text.match(/#[a-zA-Z0-9_]+/g) ?? [];
    return [...new Set(matches.map((t) => t.slice(1).toLowerCase()))];
  }

  // ─── Process tags when a caption is created ──────────────────────────────────

  async processTagsForCaption(captionId: string, text: string): Promise<void> {
    const names = this.extractTags(text);
    if (!names.length) return;

    for (const name of names) {
      try {
        const tag = await this.db.tag.upsert({
          where: { name },
          create: { name, count: 1 },
          update: { count: { increment: 1 } },
        });

        await this.db.captionTag.upsert({
          where: { captionId_tagId: { captionId, tagId: tag.id } },
          create: { captionId, tagId: tag.id },
          update: {},
        });
      } catch {
        this.logger.warn(`Failed to process tag #${name} for caption ${captionId}`);
      }
    }

    // Bust trending cache
    await this.redis.del('trending:topics:v2').catch(() => null);
  }

  // ─── When a caption is deleted, decrement tag counts ─────────────────────────

  async removeTagsForCaption(captionId: string): Promise<void> {
    const links = await this.db.captionTag.findMany({
      where: { captionId },
      select: { tagId: true },
    });

    if (!links.length) return;

    for (const { tagId } of links) {
      await this.db.tag
        .update({ where: { id: tagId }, data: { count: { decrement: 1 } } })
        .catch(() => null);
    }
  }

  // ─── GET /tags/search ─────────────────────────────────────────────────────────

  async searchTags(query: string, pagination: PaginationDto) {
    const q = (query?.startsWith('#') ? query.slice(1) : query).trim().toLowerCase();
    if (!q) return { data: [], total: 0 };

    const cacheKey = `tag_search:${q}:${pagination.page}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const where = { name: { contains: q, mode: 'insensitive' as const } };

    const [tags, total] = await Promise.all([
      this.db.tag.findMany({
        where,
        orderBy: { count: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.db.tag.count({ where }),
    ]);

    const result = { data: tags, total, page: pagination.page, limit: pagination.limit };
    await this.redis.set(cacheKey, JSON.stringify(result), TAG_SEARCH_CACHE_TTL);
    return result;
  }

  // ─── GET /tags/:name/memes ────────────────────────────────────────────────────

  async getMemesByTag(tagName: string, pagination: PaginationDto, userId?: string) {
    const name = tagName.startsWith('#') ? tagName.slice(1).toLowerCase() : tagName.toLowerCase();

    const tag = await this.db.tag.findUnique({ where: { name } });
    if (!tag) throw new NotFoundException(`Tag #${name} not found`);

    const captionLinks = await this.db.captionTag.findMany({
      where: { tagId: tag.id },
      include: {
        caption: {
          include: {
            meme: true,
            user: { select: SAFE_USER },
            _count: { select: { likes: true } },
          },
        },
      },
      orderBy: { caption: { createdAt: 'desc' } },
      skip: pagination.skip,
      take: pagination.limit,
    });

    const total = await this.db.captionTag.count({ where: { tagId: tag.id } });

    const validCaptions = captionLinks
      .map((l) => l.caption)
      .filter((c) => c.isActive && c.reportCount < 5 && c.meme?.isActive);

    // Deduplicate by meme, keeping the top-ranked caption per meme
    const memeMap = new Map<string, (typeof validCaptions)[0]>();
    for (const c of validCaptions) {
      const existing = memeMap.get(c.memeId);
      if (!existing || c.rank > existing.rank) memeMap.set(c.memeId, c);
    }

    const memes = [...memeMap.values()];

    // Enrich with is_liked
    if (userId && memes.length) {
      const likedRows = await this.db.like.findMany({
        where: { userId, captionId: { in: memes.map((c) => c.id) } },
        select: { captionId: true },
      });
      const likedSet = new Set(likedRows.map((l) => l.captionId));
      return {
        tag,
        data: memes.map((c) => ({ ...c, is_liked: likedSet.has(c.id) })),
        total,
        page: pagination.page,
        limit: pagination.limit,
      };
    }

    return {
      tag,
      data: memes.map((c) => ({ ...c, is_liked: false })),
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  // ─── Trending Topics (enhanced) ───────────────────────────────────────────────

  async getTrendingTopics(): Promise<string[]> {
    const cacheKey = 'trending:topics:v2';
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const since = new Date(Date.now() - TRENDING_WINDOW_H * 3_600_000);

    // Get tags used in the last 24 hours via CaptionTag + Caption join
    const recentTagData = await this.db.$queryRaw<
      Array<{ tag_name: string; usage_count: bigint; unique_users: bigint; total_likes: bigint }>
    >`
      SELECT
        t.name              AS tag_name,
        COUNT(ct.caption_id)                          AS usage_count,
        COUNT(DISTINCT c."user_id")                   AS unique_users,
        COALESCE(SUM(c.likes_count), 0)               AS total_likes
      FROM tags t
      JOIN caption_tags ct ON ct.tag_id = t.id
      JOIN captions c      ON c.id = ct.caption_id
      WHERE c.is_active = true
        AND c.created_at >= ${since}
      GROUP BY t.name
      ORDER BY
        (COUNT(ct.caption_id) * 2 + COUNT(DISTINCT c."user_id") * 5 + COALESCE(SUM(c.likes_count), 0) * 0.1) DESC
      LIMIT 8
    `;

    const trending = recentTagData.map((r) => r.tag_name);

    // Fallback to caption-text extraction if no Tag records yet
    if (!trending.length) {
      const fallback = await this.trendingFallback(since);
      await this.redis.set(cacheKey, JSON.stringify(fallback), TRENDING_CACHE_TTL);
      return fallback;
    }

    await this.redis.set(cacheKey, JSON.stringify(trending), TRENDING_CACHE_TTL);
    return trending;
  }

  // ─── Private: fallback trending when no Tag rows exist ───────────────────────

  private async trendingFallback(since: Date): Promise<string[]> {
    const captions = await this.db.caption.findMany({
      where: { isActive: true, createdAt: { gte: since } },
      select: { text: true, likesCount: true },
      orderBy: { likesCount: 'desc' },
      take: 2000,
    });

    const scores: Record<string, number> = {};
    for (const { text, likesCount } of captions) {
      const tags = text.match(/#[a-zA-Z0-9_]+/g) ?? [];
      for (const tag of tags) {
        const key = tag.toLowerCase();
        scores[key] = (scores[key] ?? 0) + 2 + likesCount * 0.1;
      }
    }

    return Object.entries(scores)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name]) => name);
  }
}
