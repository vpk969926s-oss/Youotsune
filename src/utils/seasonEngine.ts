/**
 * Weekly Season Engine (JST UTC+9) - Version 1.3.0
 * 
 * New Season Start: 2026/09/07 (Mon) 00:00:00 JST
 * - Active Match Phase: Monday 00:00:00 JST 〜 Sunday 23:59:59.999 JST
 * - Aggregation Window: Monday 00:00:00 JST 〜 00:59:59.999 JST ("ランキング集計中")
 * - Finalization & Rewards: Monday 01:00:00 JST
 * - Unique week_id: e.g. "2026-09-07_week", "2026-09-14_week"
 */
import { Language } from '../types';

export interface SeasonInfo {
  seasonNumber: number;
  weekId: string;
  seasonLabel: string;
  seasonNameJa: string;
  seasonNameEn: string;
  startDate: Date;
  endDate: Date;
  startDateMs: number;
  endDateMs: number;
  aggregationEndMs: number;
  formattedRange: string;
  remainingTimeTextJa: string;
  remainingTimeTextEn: string;
  remainingSeconds: number;
  isActive: boolean;
  phase: SeasonPhase;
}

export type SeasonPhase = 'ACTIVE' | 'AGGREGATING' | 'FINALIZED';

// JST Offset in milliseconds: +9 hours
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// v1.4.0 Season 1: 2026-09-13 00:00:00 JST (2026-09-12 15:00:00 UTC) to 2026-09-20 23:59:59.999 JST
export const V140_START_MS = Date.UTC(2026, 8, 12, 15, 0, 0); // 2026-09-13 00:00:00 JST
export const V132_START_MS = V140_START_MS;
export const V130_START_MS = V140_START_MS;
export const SEASON_1_START_MS = V140_START_MS;

// First season is from 2026-09-13 00:00:00 JST to 2026-09-20 23:59:59.999 JST (7 days)
export const SEASON_1_END_MS = Date.UTC(2026, 8, 20, 14, 59, 59, 999);
export const SEASON_2_START_MS = Date.UTC(2026, 8, 20, 15, 0, 0); // 2026-09-21 00:00:00 JST

export const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const AGGREGATION_DURATION_MS = 60 * 60 * 1000; // 1 hour (00:00 - 01:00 JST)

/**
 * Returns current timestamp converted to JST Date object
 */
export function getNowJST(baseTimestamp: number = Date.now()): Date {
  return new Date(baseTimestamp + JST_OFFSET_MS);
}

/**
 * Helper to generate unique week_id formatted string: YYYY-MM-DD_week
 */
export function formatWeekId(startMs: number): string {
  const d = new Date(startMs + JST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const date = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${date}_week`;
}

/**
 * Determine which season number a timestamp belongs to (1-indexed starting at 2026-09-09)
 */
export function getSeasonNumberForTimestamp(timestamp: number): number {
  if (timestamp < SEASON_1_START_MS) {
    // Archived matches prior to v1.3.2 2026-09-09
    return 0;
  }
  if (timestamp <= SEASON_1_END_MS) {
    return 1;
  }
  const diff = timestamp - SEASON_2_START_MS;
  return Math.floor(diff / ONE_WEEK_MS) + 2;
}

/**
 * Get unique week_id for a given timestamp
 */
export function getWeekIdForTimestamp(timestamp: number): string {
  const sNum = getSeasonNumberForTimestamp(timestamp);
  if (sNum <= 0) {
    return 'legacy_pre_2026-09-13_week';
  }
  const { weekId } = getSeasonRange(sNum);
  return weekId;
}

/**
 * Current week_id helper
 */
export function getCurrentWeekId(): string {
  return getWeekIdForTimestamp(Date.now());
}

/**
 * Get exact time range and boundaries for any season number
 */
export function getSeasonRange(seasonNum: number): {
  startMs: number;
  endMs: number;
  aggregationEndMs: number;
  weekId: string;
} {
  if (seasonNum <= 0) {
    return {
      startMs: 0,
      endMs: SEASON_1_START_MS - 1,
      aggregationEndMs: SEASON_1_START_MS - 1,
      weekId: 'legacy_pre_2026-09-13_week',
    };
  }

  if (seasonNum === 1) {
    return {
      startMs: SEASON_1_START_MS,
      endMs: SEASON_1_END_MS,
      aggregationEndMs: SEASON_1_END_MS + AGGREGATION_DURATION_MS,
      weekId: '2026-09-13_week',
    };
  }

  const offsetWeeks = seasonNum - 2;
  const startMs = SEASON_2_START_MS + offsetWeeks * ONE_WEEK_MS;
  const endMs = startMs + ONE_WEEK_MS - 1;
  const aggregationEndMs = endMs + AGGREGATION_DURATION_MS;
  const weekId = formatWeekId(startMs);

  return { startMs, endMs, aggregationEndMs, weekId };
}

/**
 * Format date in JST for display (e.g. 2026/09/07)
 */
function formatJSTDate(utcMs: number, includeDayOfWeek = false): string {
  const d = new Date(utcMs + JST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const date = String(d.getUTCDate()).padStart(2, '0');

  if (!includeDayOfWeek) {
    return `${year}/${month}/${date}`;
  }

  const daysJa = ['日', '月', '火', '水', '木', '金', '土'];
  const dayName = daysJa[d.getUTCDay()];
  return `${year}/${month}/${date}(${dayName})`;
}

/**
 * Get the current phase of a season
 */
export function getSeasonPhase(seasonNum: number, currentTimestamp: number = Date.now()): SeasonPhase {
  if (seasonNum <= 0) return 'FINALIZED';

  const { startMs, endMs, aggregationEndMs } = getSeasonRange(seasonNum);
  if (currentTimestamp < startMs) return 'ACTIVE';
  if (currentTimestamp <= endMs) return 'ACTIVE';
  if (currentTimestamp <= aggregationEndMs) return 'AGGREGATING';
  return 'FINALIZED';
}

/**
 * Detailed season info object
 */
export function getSeasonInfo(seasonNum?: number, currentTimestamp: number = Date.now()): SeasonInfo {
  const currentSeasonNum = Math.max(1, getSeasonNumberForTimestamp(currentTimestamp));
  const targetSeason = typeof seasonNum === 'number' ? seasonNum : currentSeasonNum;

  const { startMs, endMs, aggregationEndMs, weekId } = getSeasonRange(targetSeason);
  const startDate = new Date(startMs);
  const endDate = new Date(endMs);

  const startFormatted = formatJSTDate(startMs, true);
  const endFormatted = formatJSTDate(endMs, true);
  const formattedRange = `${startFormatted} 00:00 〜 ${endFormatted} 23:59 (JST)`;

  const phase = getSeasonPhase(targetSeason, currentTimestamp);

  // Remaining time calculation based on active match phase end
  const remainingMs = Math.max(0, endMs - currentTimestamp);
  const remainingSeconds = Math.floor(remainingMs / 1000);

  const days = Math.floor(remainingSeconds / 86400);
  const hours = Math.floor((remainingSeconds % 86400) / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  let remainingTimeTextJa = '';
  let remainingTimeTextEn = '';

  if (phase === 'AGGREGATING') {
    remainingTimeTextJa = 'ランキング集計中 (01:00 確定)';
    remainingTimeTextEn = 'Tallying Leaderboard (01:00 JST)';
  } else if (phase === 'FINALIZED') {
    remainingTimeTextJa = 'シーズン終了 (ランキング確定済み)';
    remainingTimeTextEn = 'Season Finalized';
  } else if (days > 0) {
    remainingTimeTextJa = `残り ${days}日 ${hours}時間 ${minutes}分`;
    remainingTimeTextEn = `${days}d ${hours}h ${minutes}m left`;
  } else if (hours > 0) {
    remainingTimeTextJa = `残り ${hours}時間 ${minutes}分 ${seconds}秒`;
    remainingTimeTextEn = `${hours}h ${minutes}m ${seconds}s left`;
  } else {
    remainingTimeTextJa = `残り ${minutes}分 ${seconds}秒`;
    remainingTimeTextEn = `${minutes}m ${seconds}s left`;
  }

  return {
    seasonNumber: targetSeason,
    weekId,
    seasonLabel: `SEASON ${targetSeason} (${weekId})`,
    seasonNameJa: `週間ランキング 第${targetSeason}週 (${weekId})`,
    seasonNameEn: `Weekly Season ${targetSeason} (${weekId})`,
    startDate,
    endDate,
    startDateMs: startMs,
    endDateMs: endMs,
    aggregationEndMs,
    formattedRange,
    remainingTimeTextJa,
    remainingTimeTextEn,
    remainingSeconds,
    isActive: targetSeason === currentSeasonNum && phase === 'ACTIVE',
    phase,
  };
}

export function getCurrentSeasonInfo(currentTimestamp: number = Date.now()): SeasonInfo {
  return getSeasonInfo(undefined, currentTimestamp);
}

/**
 * Format season period string
 */
export function formatSeasonPeriod(seasonNum: number, lang: Language = 'ja'): string {
  const info = getSeasonInfo(seasonNum);
  return info.formattedRange;
}

/**
 * Get available seasons up to current
 */
export function getAvailableSeasons(currentTimestamp: number = Date.now()): SeasonInfo[] {
  const currentSeasonNum = Math.max(1, getSeasonNumberForTimestamp(currentTimestamp));
  const list: SeasonInfo[] = [];

  for (let s = currentSeasonNum; s >= 1; s--) {
    list.push(getSeasonInfo(s, currentTimestamp));
  }

  return list;
}

export function getHistoricalSeasons(currentTimestamp: number = Date.now()): SeasonInfo[] {
  return getAvailableSeasons(currentTimestamp);
}

export function isSeasonInAggregationPhase(seasonNum: number, currentTimestamp: number = Date.now()): boolean {
  return getSeasonPhase(seasonNum, currentTimestamp) === 'AGGREGATING';
}

export function isSeasonFinalized(seasonNum: number, currentTimestamp: number = Date.now()): boolean {
  return getSeasonPhase(seasonNum, currentTimestamp) === 'FINALIZED';
}
