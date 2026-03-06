/**
 * Caption ranking score — balances engagement vs recency.
 *
 * Formula: score = (likes * 4 + views * 0.2 + 1) / time_decay
 * Time decay: (hours_old / 6 + 1) ^ 1.5
 *
 * Example decay:
 *   0 h  → ÷ 1.00  (full score)
 *   6 h  → ÷ 2.83
 *  24 h  → ÷ 11.18
 *  72 h  → ÷ 50.00
 */
export function calculateRank(
  likesCount: number,
  viewsCount: number,
  createdAt: Date,
): number {
  const hoursOld = Math.max(0, (Date.now() - createdAt.getTime()) / 3_600_000);
  const timePenalty = Math.pow(hoursOld / 6 + 1, 1.5);
  const score = (likesCount * 4 + viewsCount * 0.2 + 1) / timePenalty;
  return Math.round(score * 1000) / 1000;
}

/** Incremental rank delta when a like is added (+) or removed (-). */
export const LIKE_RANK_DELTA = 4;

/** Incremental rank delta when a view is recorded. */
export const VIEW_RANK_DELTA = 0.2;
