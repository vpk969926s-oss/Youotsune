import { supabase } from './supabase';
import { BetaStandingEntry } from '../types';

const ADMIN_ADJUSTMENT_PREFIX = 'PVP_ADMIN_ADJUSTMENT:';

export interface AdminRankingAdjustment {
  playerId: string;
  mode: 'OVR' | 'TACTICAL';
  pointsDelta: number;
  updatedAt: number;
}

function isAdminRankingAdjustment(value: unknown): value is AdminRankingAdjustment {
  if (!value || typeof value !== 'object') return false;
  const record = value as AdminRankingAdjustment;
  return typeof record.playerId === 'string' && record.playerId.trim().length > 0 &&
    (record.mode === 'OVR' || record.mode === 'TACTICAL') &&
    Number.isFinite(record.pointsDelta) && Number.isFinite(record.updatedAt);
}

/** Development/admin entry point. Write access is governed by Supabase policies; no UI calls this. */
export async function saveAdminRankingAdjustment(
  playerId: string,
  mode: AdminRankingAdjustment['mode'],
  pointsDelta: number
): Promise<{ success: boolean; error?: string }> {
  const record: AdminRankingAdjustment = { playerId, mode, pointsDelta, updatedAt: Date.now() };
  if (!isAdminRankingAdjustment(record)) {
    return { success: false, error: 'Invalid ranking point adjustment' };
  }
  try {
    const { error } = await supabase.from('leaderboard').insert({
      player_name: ADMIN_ADJUSTMENT_PREFIX + JSON.stringify(record),
      score: pointsDelta,
    });
    return error ? { success: false, error: error.message } : { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Adjustment save failed' };
  }
}

/** Apply once to fully aggregated standings. Adjustments have no season/week scope. */
export async function applyAdminRankingAdjustments(
  standings: BetaStandingEntry[],
  mode: 'ALL' | AdminRankingAdjustment['mode']
): Promise<BetaStandingEntry[]> {
  try {
    const latest = new Map<string, AdminRankingAdjustment>();
    const pageSize = 500;
    // Read every page so older adjustments for other players are not lost.
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from('leaderboard')
        .select('id, created_at, player_name')
        .like('player_name', `${ADMIN_ADJUSTMENT_PREFIX}%`)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      for (const row of data || []) {
        try {
          if (typeof row.player_name !== 'string' || !row.player_name.startsWith(ADMIN_ADJUSTMENT_PREFIX)) continue;
          const record: unknown = JSON.parse(row.player_name.slice(ADMIN_ADJUSTMENT_PREFIX.length));
          if (!isAdminRankingAdjustment(record)) continue;
          const key = JSON.stringify([record.playerId, record.mode]);
          const previous = latest.get(key);
          if (!previous || record.updatedAt > previous.updatedAt) latest.set(key, record);
        } catch {
          // Ignore malformed management records without affecting normal standings.
        }
      }
      if (!data || data.length < pageSize) break;
    }
    if (latest.size === 0) return standings;

    const deltaByPlayer = new Map<string, number>();
    for (const record of latest.values()) {
      if (mode === 'ALL' || record.mode === mode) {
        deltaByPlayer.set(record.playerId, (deltaByPlayer.get(record.playerId) || 0) + record.pointsDelta);
      }
    }
    return standings.map(entry => ({
      ...entry,
      points: entry.points + (deltaByPlayer.get(entry.userId) || 0),
    })).sort((a, b) =>
      b.points - a.points || b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor || b.wins - a.wins || b.teamOvr - a.teamOvr ||
      a.userId.localeCompare(b.userId)
    ).map((entry, index) => ({ ...entry, rank: index + 1 }));
  } catch (error) {
    console.warn('Admin ranking adjustment error:', error);
    return standings;
  }
}
