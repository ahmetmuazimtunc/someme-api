import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';

/** Result types matching the mobile app's enum */
const TYPE_USER = 1;
const TYPE_TAG = 2;
const TYPE_CAPTION = 3;

const USER_LIMIT = 5;
const TAG_LIMIT = 5;
const CAPTION_LIMIT = 10;

/** Universal search result cache: 1 minute TTL */
const SEARCH_CACHE_TTL = 60;

/** Report threshold — captions with this many reports are hidden */
const REPORT_HIDE_THRESHOLD = 5;

@Injectable()
export class SearchService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Universal live-search across users (type 1), hashtags (type 2) and captions (type 3).
   * Designed for as-you-type use — returns mixed results in a single flat array.
   */
  async universalSearch(query: string, currentUserId?: string) {
    const q = query?.trim();
    if (!q || q.length < 1) return { results: [] };

    // Cache key includes userId so is_following / is_liked are correct per user
    const cacheKey = `search:${q.toLowerCase()}:${currentUserId ?? 'anon'}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const [users, tags, captions] = await Promise.all([
      this.searchUsers(q, currentUserId),
      this.searchTags(q),
      this.searchCaptions(q, currentUserId),
    ]);

    const results = [
      ...users.map((u) => ({ type: TYPE_USER, ...u })),
      ...(tags as Array<Record<string, unknown>>).map((t) => ({ type: TYPE_TAG, ...t })),
      ...captions.map((c) => ({ type: TYPE_CAPTION, ...c })),
    ];

    const response = { results };
    await this.redis.set(cacheKey, JSON.stringify(response), SEARCH_CACHE_TTL);
    return response;
  }

  // ─── Users (type 1) ──────────────────────────────────────────────────────────

  private async searchUsers(q: string, currentUserId?: string) {
    const users = await this.db.user.findMany({
      where: {
        isActive: true,
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        photoUrl: true,
        isVerified: true,
        _count: { select: { followers: true } },
      },
      orderBy: [{ isVerified: 'desc' }],
      take: USER_LIMIT,
    });

    if (!currentUserId || !users.length) {
      return users.map((u) => ({
        id: u.id,
        username: u.username,
        display_name: u.displayName,
        photo: u.photoUrl,
        is_verified: u.isVerified,
        followers_count: u._count.followers,
        is_following: false,
      }));
    }

    const followingRows = await this.db.follow.findMany({
      where: { followerId: currentUserId, followingId: { in: users.map((u) => u.id) } },
      select: { followingId: true },
    });
    const followingSet = new Set(followingRows.map((f) => f.followingId));

    return users.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.displayName,
      photo: u.photoUrl,
      is_verified: u.isVerified,
      followers_count: u._count.followers,
      is_following: followingSet.has(u.id),
    }));
  }

  // ─── Hashtags (type 2) — queries Tag table ────────────────────────────────────

  private async searchTags(q: string) {
    const normalised = (q.startsWith('#') ? q.slice(1) : q).toLowerCase();

    // First try to find from the Tag table (populated as captions are created)
    const tags = await this.db.tag.findMany({
      where: { name: { contains: normalised, mode: 'insensitive' } },
      orderBy: { count: 'desc' },
      take: TAG_LIMIT,
    });

    if (tags.length) {
      return tags.map((t: { name: string; count: number }) => ({ name: `#${t.name}`, caption_count: t.count }));
    }

    // Fallback: scan caption texts from the last 30 days (pre-tag-system content)
    return this.searchTagsFallback(normalised);
  }

  private async searchTagsFallback(normalised: string) {
    const cacheKey = `tag_search_fallback:${normalised}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const since = new Date(Date.now() - 30 * 24 * 3_600_000);
    const recentCaptions = await this.db.caption.findMany({
      where: {
        isActive: true,
        createdAt: { gte: since },
        text: { contains: `#${normalised}`, mode: 'insensitive' },
      },
      select: { text: true },
      take: 500,
    });

    const tagCount: Record<string, number> = {};
    const regex = new RegExp(`#[a-zA-Z0-9_]*${normalised}[a-zA-Z0-9_]*`, 'gi');

    for (const { text } of recentCaptions) {
      const matches = text.match(regex) ?? [];
      for (const tag of matches) {
        const lower = tag.toLowerCase();
        tagCount[lower] = (tagCount[lower] ?? 0) + 1;
      }
    }

    const result = Object.entries(tagCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, TAG_LIMIT)
      .map(([name, count]) => ({ name, caption_count: count }));

    await this.redis.set(cacheKey, JSON.stringify(result), 600);
    return result;
  }

  // ─── Captions (type 3) ───────────────────────────────────────────────────────

  private async searchCaptions(q: string, currentUserId?: string) {
    const captions = await this.db.caption.findMany({
      where: {
        isActive: true,
        reportCount: { lt: REPORT_HIDE_THRESHOLD },
        text: { contains: q, mode: 'insensitive' },
      },
      select: {
        id: true,
        text: true,
        likesCount: true,
        rank: true,
        language: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            photoUrl: true,
            isVerified: true,
          },
        },
        meme: {
          select: {
            id: true,
            thumbnailUrl: true,
            imageUrl: true,
            width: true,
            height: true,
          },
        },
      },
      orderBy: [{ rank: 'desc' }, { likesCount: 'desc' }],
      take: CAPTION_LIMIT,
    });

    if (!currentUserId || !captions.length) {
      return captions.map((c) => ({ ...c, is_liked: false }));
    }

    const likedRows = await this.db.like.findMany({
      where: { userId: currentUserId, captionId: { in: captions.map((c) => c.id) } },
      select: { captionId: true },
    });
    const likedSet = new Set(likedRows.map((l) => l.captionId));

    return captions.map((c) => ({ ...c, is_liked: likedSet.has(c.id) }));
  }
}
