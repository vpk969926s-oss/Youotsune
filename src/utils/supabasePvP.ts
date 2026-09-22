import { supabase } from './supabase';
import {
  BetaUserProfile,
  BetaMatchRecord,
  BetaStandingEntry,
  UserTeam,
  TeamTactics,
  Player,
} from '../types';
import { DEFAULT_TACTICS, computeWeeklyStandings, getCurrentUserProfile } from './pvpEngine';
import { getTeamEffectiveOvr } from './positionEngine';
import { getSeasonNumberForTimestamp, getSeasonInfo, SEASON_1_START_MS, getWeekIdForTimestamp, getSeasonRange, V130_START_MS, getCurrentWeekId } from './seasonEngine';
import { EUROPEAN_PLAYERS } from '../data/playersEurope';

const PRESENCE_CHANNEL_NAME = 'pvp_global_presence_v113';
const DATA_SYNC_CHANNEL_NAME = 'pvp_data_sync_v113';
const LOCAL_STORAGE_REAL_USERS = 'FOOTBALL_DRAFT_PVP_REAL_USERS_V113';
const LOCAL_STORAGE_CURRENT_USER_ID = 'FOOTBALL_DRAFT_PVP_USER_ID_V113';
const LOCAL_STORAGE_CURRENT_HANDLE = 'FOOTBALL_DRAFT_PVP_CURRENT_HANDLE_V113';
const LOCAL_STORAGE_SAVED_MATCHES = 'FOOTBALL_DRAFT_PVP_SAVED_MATCHES_V113';
const LOCAL_STORAGE_V113_CLEARED = 'FOOTBALL_DRAFT_V113_MIGRATION_CLEARED_MATCHES';
const LOCAL_STORAGE_V130_RANKING_RESET = 'FOOTBALL_DRAFT_V130_RANKING_RESET_DONE';

// In-memory cache of online presence tracked via Supabase Realtime
let onlinePresenceUsers: Map<string, BetaUserProfile> = new Map();
let presenceChannel: any = null;
let syncChannel: any = null;
let heartbeatTimer: any = null;
let onOnlineUsersCallback: ((users: BetaUserProfile[]) => void) | null = null;
let onMatchInviteCallback: ((invite: any) => void) | null = null;

/**
 * Synchronize profile to server-side authority
 */
export async function syncProfileToServer(profile: BetaUserProfile): Promise<void> {
  try {
    await fetch('/api/pvp/sync-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: profile.userId,
        username: profile.username,
        team: profile.team,
        tactics: profile.tactics,
        defenseSquadId: profile.defenseSquadId,
        tacticalDefenseSquad: profile.tacticalDefenseSquad,
        ovrDefenseSquad: profile.ovrDefenseSquad,
      }),
    });
  } catch (e) {
    console.warn('Server sync-profile note:', e);
  }
}

/**
 * Record completed match to server-side authority
 */
export async function recordMatchToServer(record: BetaMatchRecord): Promise<void> {
  try {
    await fetch('/api/pvp/record-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  } catch (e) {
    console.warn('Server record-match note:', e);
  }
}

/**
 * Fetch all registered users from server authority
 */
export async function fetchServerUsers(): Promise<BetaUserProfile[]> {
  try {
    const res = await fetch('/api/pvp/users');
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.users)) {
        return data.users.map((u: any) => ({
          userId: u.userId,
          username: u.username,
          team: u.team || null,
          tactics: u.tactics || DEFAULT_TACTICS,
          defenseSquadId: u.defenseSquadId,
          updatedAt: u.updatedAt || Date.now(),
          isOnline: true,
          lastSeen: u.updatedAt || Date.now(),
        }));
      }
    }
  } catch (e) {
    console.warn('Server fetch users note:', e);
  }
  return [];
}

/**
 * Fetch all season matches from server authority
 */
export async function fetchServerMatches(seasonNumber?: number, weekId?: string): Promise<BetaMatchRecord[]> {
  try {
    const params = new URLSearchParams();
    if (seasonNumber !== undefined) params.append('seasonNumber', String(seasonNumber));
    if (weekId) params.append('weekId', weekId);
    const res = await fetch(`/api/pvp/matches?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.matches)) {
        return data.matches;
      }
    }
  } catch (e) {
    console.warn('Server fetch matches note:', e);
  }
  return [];
}

/**
 * Perform one-time match history cleanup for v1.1.3 release
 */
export const LOCAL_STORAGE_V132_RANKING_RESET = 'FOOTBALL_DRAFT_V132_RANKING_RESET_DONE';

export function checkAndPerformV113Migration(): void {
  try {
    const alreadyMigrated = localStorage.getItem(LOCAL_STORAGE_V113_CLEARED);
    if (!alreadyMigrated) {
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_SAVED_MATCHES_V1');
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_HISTORY_v110');
      localStorage.removeItem(LOCAL_STORAGE_SAVED_MATCHES);
      localStorage.setItem(LOCAL_STORAGE_V113_CLEARED, 'true');
    }
  } catch (e) {
    console.warn('Migration cleanup error:', e);
  }
}

/**
 * v1.3.2 Weekly Ranking Reset (2026/09/09 Start):
 * Completely resets all local past match records and rankings,
 * while strictly protecting owned players, formations, MY TEAM, draft history, etc.
 */
export function checkAndPerformV132RankingReset(): void {
  try {
    const alreadyReset = localStorage.getItem(LOCAL_STORAGE_V132_RANKING_RESET);
    if (!alreadyReset) {
      localStorage.removeItem(LOCAL_STORAGE_SAVED_MATCHES);
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_SAVED_MATCHES_V1');
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_HISTORY_v110');
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_HISTORY_v113');
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_MATCHES');
      localStorage.removeItem('FOOTBALL_DRAFT_V130_RANKING_RESET_DONE');
      localStorage.setItem(LOCAL_STORAGE_V132_RANKING_RESET, 'true');
      console.log('v1.3.2 Ranking data and match history reset performed cleanly.');
    }
  } catch (e) {
    console.warn('v1.3.2 Ranking reset cleanup error:', e);
  }
}

/**
 * v1.3.0 Weekly Ranking Reset:
 * Resets weekly match ranking records to start fresh as requested,
 * while strictly protecting owned players, formations, MY TEAM, draft history, etc.
 */
export function checkAndPerformV130RankingReset(): void {
  checkAndPerformV132RankingReset();
}

export const LOCAL_STORAGE_V150_MATCH_HISTORY_RESET = 'FOOTBALL_DRAFT_V150_MATCH_HISTORY_RESET_DONE';

/**
 * v1.5.0 One-time Match History Reset:
 * Strictly clears past match history display and opponent match restriction history ONCE,
 * while 100% protecting and preserving weekly rankings, points, standings, user data, MY TEAM, presents, and tickets.
 */
export async function checkAndPerformV150MatchHistoryReset(): Promise<void> {
  try {
    const alreadyDone = localStorage.getItem(LOCAL_STORAGE_V150_MATCH_HISTORY_RESET);
    if (!alreadyDone) {
      // 1. Clear local match history caches
      localStorage.removeItem(LOCAL_STORAGE_SAVED_MATCHES);
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_SAVED_MATCHES_V1');
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_HISTORY_v110');
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_HISTORY_v113');
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_MATCHES');

      // 2. Authoritatively reset past match records on the server while preserving standingsMap
      try {
        await fetch('/api/pvp/reset-match-history-only', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: 'v1.5.0' }),
        });
      } catch (srvErr) {
        console.warn('Server match history reset note:', srvErr);
      }

      localStorage.setItem(LOCAL_STORAGE_V150_MATCH_HISTORY_RESET, 'true');
      console.log('v1.5.0 One-time Match History Reset performed cleanly. Rankings, points, and user data are strictly preserved.');
    }
  } catch (e) {
    console.warn('v1.5.0 match history reset error:', e);
  }
}

export interface WeeklyMatchedOpponentsMap {
  ovr: string[];
  tactical: string[];
  all: string[];
}

/**
 * Fetch list of opponent user IDs that the current user has already matched against in this week.
 * Enforces 1 match per week per mode (OVR and TACTICAL each 1 match per week between the same two users).
 * Queries authoritative server endpoint /api/pvp/matched-opponents and Supabase online DB.
 */
export async function fetchMatchedOpponentsThisWeek(
  userId: string,
  weekId: string
): Promise<WeeklyMatchedOpponentsMap> {
  const ovrSet = new Set<string>();
  const tacticalSet = new Set<string>();
  if (!userId) return { ovr: [], tactical: [], all: [] };

  // 1. Authoritative Server query
  try {
    const res = await fetch(`/api/pvp/matched-opponents?userId=${encodeURIComponent(userId)}&weekId=${encodeURIComponent(weekId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        if (Array.isArray(data.ovrMatchedOpponentIds)) {
          data.ovrMatchedOpponentIds.forEach((id: string) => ovrSet.add(id));
        }
        if (Array.isArray(data.tacticalMatchedOpponentIds)) {
          data.tacticalMatchedOpponentIds.forEach((id: string) => tacticalSet.add(id));
        }
      }
    }
  } catch (e) {
    console.warn('Server matched opponents check note:', e);
  }

  // 2. Supabase online DB query for matches in this week (cross-browser / cross-device)
  try {
    const { data: dbMatches, error } = await supabase
      .from('matches')
      .select('challenger_id, opponent_id, week_id, match_type, created_at')
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
      .limit(200);

    if (!error && dbMatches) {
      dbMatches.forEach((row: any) => {
        const mWeekId = row.week_id || (row.created_at ? getWeekIdForTimestamp(new Date(row.created_at).getTime()) : weekId);
        if (mWeekId === weekId || weekId === '2026-09-13_week') {
          const rawType = String(row.match_type || '').toUpperCase();
          const isTactical = rawType.includes('TACTICAL');
          const targetSet = isTactical ? tacticalSet : ovrSet;

          if (row.challenger_id === userId && row.opponent_id) {
            targetSet.add(row.opponent_id);
          } else if (row.opponent_id === userId && row.challenger_id) {
            targetSet.add(row.challenger_id);
          }
        }
      });
    }
  } catch (sbErr) {
    console.warn('Supabase matched opponents check note:', sbErr);
  }

  // 3. Check local matches for current week as fallback
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SAVED_MATCHES);
    if (raw) {
      const list: BetaMatchRecord[] = JSON.parse(raw);
      list.forEach((m) => {
        const mWeekId = m.weekId || (m.timestamp ? getWeekIdForTimestamp(m.timestamp) : weekId);
        if (mWeekId === weekId || weekId === '2026-09-13_week') {
          const rawType = String(m.matchType || (m as any).mode || '').toUpperCase();
          const isTactical = rawType.includes('TACTICAL');
          const targetSet = isTactical ? tacticalSet : ovrSet;

          if (m.challengerUserId === userId && m.opponentUserId) {
            targetSet.add(m.opponentUserId);
          } else if (m.opponentUserId === userId && m.challengerUserId) {
            targetSet.add(m.challengerUserId);
          }
        }
      });
    }
  } catch {}

  const ovr = Array.from(ovrSet);
  const tactical = Array.from(tacticalSet);
  const all = Array.from(new Set([...ovr, ...tactical]));

  return { ovr, tactical, all };
}

// Run migrations immediately on module load
checkAndPerformV113Migration();
checkAndPerformV132RankingReset();
checkAndPerformV150MatchHistoryReset();

/**
 * Get or create a persistent user ID for this browser
 */
export function getPersistentUserId(): string {
  try {
    let id = localStorage.getItem(LOCAL_STORAGE_CURRENT_USER_ID);
    if (!id) {
      // Migrate from old key if exists
      const oldId = localStorage.getItem('FOOTBALL_DRAFT_PVP_USER_ID_V1');
      id = oldId || 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
      localStorage.setItem(LOCAL_STORAGE_CURRENT_USER_ID, id);
    }
    return id;
  } catch {
    return 'usr_' + Date.now().toString(36);
  }
}

/**
 * Get saved handle from localStorage
 */
export function getSavedUserHandle(): string {
  try {
    return (
      localStorage.getItem(LOCAL_STORAGE_CURRENT_HANDLE) ||
      localStorage.getItem('FOOTBALL_DRAFT_PVP_CURRENT_HANDLE_V1') ||
      ''
    );
  } catch {
    return '';
  }
}

/**
 * Save handle to localStorage
 */
export function setSavedUserHandle(handle: string): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_CURRENT_HANDLE, handle);
    localStorage.setItem('FOOTBALL_DRAFT_PVP_CURRENT_HANDLE_V1', handle);
  } catch (e) {
    console.warn('Failed to save handle to storage', e);
  }
}

/**
 * Read cached real users from local storage
 */
export function getCachedRealUsers(): BetaUserProfile[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_REAL_USERS);
    if (raw) {
      const list: BetaUserProfile[] = JSON.parse(raw);
      return list.filter((u) => u && u.userId && u.username);
    }
  } catch (e) {
    console.warn('Failed to read cached real users', e);
  }
  return [];
}

/**
 * Persist cached real users
 */
function saveCachedRealUsers(users: BetaUserProfile[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_REAL_USERS, JSON.stringify(users));
  } catch (e) {
    console.warn('Failed to cache real users', e);
  }
}

/**
 * Update a user in our local real users cache
 */
function updateCachedUser(user: BetaUserProfile): void {
  const current = getCachedRealUsers().filter((u) => u.userId !== user.userId);
  current.push(user);
  saveCachedRealUsers(current);
}

/**
 * Initialize Supabase Realtime Channels for PvP (Presence + Data Sync)
 */
export function initSupabasePvP(
  currentUser: BetaUserProfile,
  onOnlineChange?: (onlineUsers: BetaUserProfile[]) => void,
  onMatchInvite?: (invite: any) => void
) {
  if (onOnlineChange) onOnlineUsersCallback = onOnlineChange;
  if (onMatchInvite) onMatchInviteCallback = onMatchInvite;

  try {
    if (presenceChannel) {
      presenceChannel.unsubscribe();
    }
    if (syncChannel) {
      syncChannel.unsubscribe();
    }

    // 1. Setup Presence Channel
    presenceChannel = supabase.channel(PRESENCE_CHANNEL_NAME, {
      config: {
        presence: {
          key: currentUser.userId,
        },
      },
    });

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const onlineMap = new Map<string, BetaUserProfile>();

        Object.keys(state).forEach((key) => {
          const presences = state[key];
          if (presences && presences.length > 0) {
            const p = presences[0] as any;
            if (p && p.userId && p.username && p.userId !== currentUser.userId) {
              const profile: BetaUserProfile = {
                userId: p.userId,
                username: p.username,
                team: p.team || null,
                tactics: p.tactics || DEFAULT_TACTICS,
                defenseSquadId: p.defenseSquadId,
                updatedAt: p.updatedAt || Date.now(),
                isOnline: true,
                lastSeen: Date.now(),
              };
              onlineMap.set(p.userId, profile);
              updateCachedUser(profile);
            }
          }
        });

        onlinePresenceUsers = onlineMap;
        if (onOnlineUsersCallback) {
          onOnlineUsersCallback(Array.from(onlineMap.values()));
        }
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }: any) => {
        if (newPresences && newPresences.length > 0) {
          const p = newPresences[0];
          if (p && p.userId && p.username && p.userId !== currentUser.userId) {
            const profile: BetaUserProfile = {
              userId: p.userId,
              username: p.username,
              team: p.team || null,
              tactics: p.tactics || DEFAULT_TACTICS,
              defenseSquadId: p.defenseSquadId,
              updatedAt: p.updatedAt || Date.now(),
              isOnline: true,
              lastSeen: Date.now(),
            };
            onlinePresenceUsers.set(p.userId, profile);
            updateCachedUser(profile);
            if (onOnlineUsersCallback) {
              onOnlineUsersCallback(Array.from(onlinePresenceUsers.values()));
            }
          }
        }
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }: any) => {
        if (leftPresences && leftPresences.length > 0) {
          leftPresences.forEach((p: any) => {
            if (p && p.userId) {
              onlinePresenceUsers.delete(p.userId);
            }
          });
          if (onOnlineUsersCallback) {
            onOnlineUsersCallback(Array.from(onlinePresenceUsers.values()));
          }
        }
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          try {
            await presenceChannel.track({
              userId: currentUser.userId,
              username: currentUser.username,
              team: currentUser.team,
              tactics: currentUser.tactics,
              defenseSquadId: currentUser.defenseSquadId,
              updatedAt: Date.now(),
              lastSeen: Date.now(),
            });
          } catch (err) {
            console.warn('Presence track error:', err);
          }
        }
      });

    // 2. Setup Data Sync Channel (Broadcasts registrations, Best XI changes, Match results)
    syncChannel = supabase.channel(DATA_SYNC_CHANNEL_NAME);
    syncChannel
      .on('broadcast', { event: 'USER_REGISTERED' }, ({ payload }: any) => {
        if (payload && payload.userId && payload.username && payload.userId !== currentUser.userId) {
          updateCachedUser(payload);
        }
      })
      .on('broadcast', { event: 'BEST_XI_SAVED' }, ({ payload }: any) => {
        if (payload && payload.userId && payload.username && payload.userId !== currentUser.userId) {
          updateCachedUser(payload);
        }
      })
      .on('broadcast', { event: 'MATCH_INVITE' }, ({ payload }: any) => {
        if (payload && payload.targetUserId === currentUser.userId) {
          if (onMatchInviteCallback) {
            onMatchInviteCallback(payload);
          }
        }
      })
      .on('broadcast', { event: 'MATCH_COMPLETED' }, ({ payload }: any) => {
        if (payload) {
          notifyMatchUpdates();
        }
      })
      .on('broadcast', { event: 'STANDINGS_RESET' }, () => {
        try {
          localStorage.removeItem(LOCAL_STORAGE_SAVED_MATCHES);
          localStorage.removeItem('fd_beta_pvp_matches');
          localStorage.removeItem('FOOTBALL_DRAFT_PVP_HISTORY_v113');
          localStorage.removeItem('FOOTBALL_DRAFT_PVP_SAVED_MATCHES_V1');
        } catch (e) {
          console.warn('Local wipe warning on broadcast:', e);
        }
        notifyMatchUpdates();
      })
      .subscribe();

    // 3. Start Heartbeat Timer (every 25 seconds)
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      sendHeartbeat(currentUser);
    }, 25000);
  } catch (err) {
    console.warn('Supabase Realtime PvP init note:', err);
  }
}

/**
 * Send heartbeat to keep presence and last_seen fresh
 */
export async function sendHeartbeat(currentUser: BetaUserProfile): Promise<void> {
  if (!currentUser || !currentUser.username) return;

  if (presenceChannel) {
    try {
      await presenceChannel.track({
        userId: currentUser.userId,
        username: currentUser.username,
        team: currentUser.team,
        tactics: currentUser.tactics,
        defenseSquadId: currentUser.defenseSquadId,
        updatedAt: Date.now(),
        lastSeen: Date.now(),
      });
    } catch (e) {
      // Graceful
    }
  }

  // Update Supabase DB table if available
  try {
    await supabase
      .from('users')
      .update({
        is_online: true,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', currentUser.userId);
  } catch (e) {
    // Graceful
  }
}

/**
 * Check if a username is already taken by another user
 */
export async function isUsernameTaken(
  username: string,
  currentUserId: string
): Promise<boolean> {
  const clean = username.trim().toLowerCase();
  if (!clean) return false;

  // Check local cache
  const cached = getCachedRealUsers();
  const foundInCache = cached.some(
    (u) => u.userId !== currentUserId && u.username.toLowerCase() === clean
  );
  if (foundInCache) return true;

  // Check Supabase DB table
  try {
    const { data, error } = await supabase
      .from('users')
      .select('user_id, username')
      .neq('user_id', currentUserId)
      .ilike('username', clean)
      .limit(1);

    if (!error && data && data.length > 0) {
      return true;
    }
  } catch (e) {
    console.warn('DB check username error', e);
  }

  return false;
}

/**
 * Register or update user profile in Supabase
 */
export async function registerOrUpdateUserInSupabase(
  profile: BetaUserProfile
): Promise<{ success: boolean; error?: string }> {
  const trimmed = profile.username.trim();
  if (!trimmed || trimmed.length < 3) {
    return {
      success: false,
      error: 'ユーザーネームは3文字以上で入力してください。',
    };
  }

  // Check uniqueness
  const taken = await isUsernameTaken(trimmed, profile.userId);
  if (taken) {
    return {
      success: false,
      error: `ユーザーネーム「${trimmed}」は既に使用されています。別の名前をお試しください。`,
    };
  }

  const updatedProfile: BetaUserProfile = {
    ...profile,
    username: trimmed,
    updatedAt: Date.now(),
    isOnline: true,
    lastSeen: Date.now(),
  };

  // 1. Save handle locally
  setSavedUserHandle(trimmed);
  updateCachedUser(updatedProfile);

  // 2. Track in Supabase Realtime presence
  if (presenceChannel) {
    try {
      await presenceChannel.track({
        userId: updatedProfile.userId,
        username: updatedProfile.username,
        team: updatedProfile.team,
        tactics: updatedProfile.tactics,
        defenseSquadId: updatedProfile.defenseSquadId,
        updatedAt: Date.now(),
        lastSeen: Date.now(),
      });
    } catch (e) {
      console.warn('Failed to track in presence', e);
    }
  }

  // 3. Broadcast to all clients via Supabase sync channel
  if (syncChannel) {
    try {
      syncChannel.send({
        type: 'broadcast',
        event: 'USER_REGISTERED',
        payload: updatedProfile,
      });
    } catch (e) {
      console.warn('Failed to broadcast user registration', e);
    }
  }

  // 4. Upsert into Supabase DB table
  try {
    const teamOvr = updatedProfile.team?.players?.length
      ? Math.round(
          updatedProfile.team.players.reduce((s, p) => s + p.rating, 0) /
            updatedProfile.team.players.length
        )
      : 85;

    await supabase.from('users').upsert(
      {
        user_id: updatedProfile.userId,
        username: updatedProfile.username,
        team_name: updatedProfile.team?.name || 'Best XI',
        formation: updatedProfile.team?.formation || '4-3-3',
        ovr: teamOvr,
        best_xi: updatedProfile.team,
        tactics: updatedProfile.tactics,
        is_online: true,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  } catch (e) {
    console.warn('Supabase DB insert warning:', e);
  }

  // 5. Always persist to server-side authority
  await syncProfileToServer(updatedProfile);

  return { success: true };
}

/**
 * Save Best XI Team and Tactics to Supabase
 */
export async function saveBestXIToSupabase(
  profile: BetaUserProfile,
  team: UserTeam,
  tactics?: TeamTactics
): Promise<{ success: boolean; error?: string }> {
  const updatedProfile: BetaUserProfile = {
    ...profile,
    team,
    tactics: tactics || profile.tactics || DEFAULT_TACTICS,
    defenseSquadId: team.teamId,
    updatedAt: Date.now(),
  };

  updateCachedUser(updatedProfile);

  // Broadcast to other clients
  if (syncChannel) {
    try {
      syncChannel.send({
        type: 'broadcast',
        event: 'BEST_XI_SAVED',
        payload: updatedProfile,
      });
    } catch (e) {
      console.warn('Broadcast best xi error', e);
    }
  }

  // Update presence
  if (presenceChannel) {
    try {
      presenceChannel.track({
        userId: updatedProfile.userId,
        username: updatedProfile.username,
        team: updatedProfile.team,
        tactics: updatedProfile.tactics,
        defenseSquadId: updatedProfile.defenseSquadId,
        updatedAt: Date.now(),
        lastSeen: Date.now(),
      });
    } catch (e) {
      console.warn('Presence track error', e);
    }
  }

  // Save to Supabase DB table
  try {
    const teamOvr = team.players?.length
      ? Math.round(team.players.reduce((s, p) => s + p.rating, 0) / team.players.length)
      : 85;

    await supabase.from('users').upsert(
      {
        user_id: updatedProfile.userId,
        username: updatedProfile.username,
        team_name: team.name,
        formation: team.formation,
        ovr: teamOvr,
        best_xi: team,
        tactics: updatedProfile.tactics,
        is_online: true,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  } catch (e) {
    console.warn('Supabase DB best_xi upsert note:', e);
  }

  // Always persist to server-side authority
  await syncProfileToServer(updatedProfile);

  return { success: true };
}

/**
 * Persist locked team to Supabase and update user's defense squad (v1.2.0)
 */
export async function saveLockedTeamToSupabase(team: UserTeam): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = getPersistentUserId();
    const username = getSavedUserHandle() || `Manager_${userId.slice(-4)}`;
    const profile: BetaUserProfile = {
      userId,
      username,
      team,
      tactics: DEFAULT_TACTICS,
      defenseSquadId: team.teamId,
      updatedAt: Date.now(),
    };
    return await saveBestXIToSupabase(profile, team);
  } catch (err: any) {
    console.warn('saveLockedTeamToSupabase warning:', err);
    return { success: false, error: err?.message };
  }
}

/**
 * Fetch list of currently online players from Supabase (excluding self)
 */
export async function fetchOnlineUsersFromSupabase(
  currentUserId: string
): Promise<BetaUserProfile[]> {
  const onlineMap = new Map<string, BetaUserProfile>();

  // 1. First add from Realtime presence state
  onlinePresenceUsers.forEach((user, id) => {
    if (id !== currentUserId && user.username) {
      onlineMap.set(id, { ...user, isOnline: true });
    }
  });

  // 2. Also query Supabase DB for users active within last 5 minutes
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .neq('user_id', currentUserId)
      .gt('last_seen', fiveMinutesAgo);

    if (!error && data) {
      data.forEach((row: any) => {
        if (row.username && row.user_id !== currentUserId) {
          const profile: BetaUserProfile = {
            userId: row.user_id,
            username: row.username,
            team: row.best_xi || null,
            tactics: row.tactics || DEFAULT_TACTICS,
            defenseSquadId: row.best_xi?.teamId,
            updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
            isOnline: true,
            lastSeen: row.last_seen ? new Date(row.last_seen).getTime() : Date.now(),
          };
          onlineMap.set(row.user_id, profile);
          updateCachedUser(profile);
        }
      });
    }
  } catch (e) {
    console.warn('Fetch online users DB note:', e);
  }

  return Array.from(onlineMap.values());
}

/**
 * Default High-Quality Community Challenge Opponents
 * Ensures every user always has diverse, authentic squads to challenge with OVR 79 ~ 93.
 */
export function getDefaultCommunityOpponents(): BetaUserProfile[] {
  // Select top players from European database
  const getPlayer = (id: string, fallback: Partial<Player>): Player => {
    const found = EUROPEAN_PLAYERS.find((p) => p.playerId === id || p.personId === id);
    if (found) return found;
    return {
      playerId: id,
      personId: id,
      playerName: fallback.playerName || 'World Star',
      nameJa: fallback.nameJa || 'ワールドスター',
      nameEn: fallback.nameEn || 'World Star',
      nameEs: fallback.nameEs || 'Estrella Mundial',
      clubId: fallback.clubId || 'real_madrid',
      clubName: fallback.clubName || 'Real Madrid',
      joiningYear: fallback.joiningYear || 2020,
      position: fallback.position || 'FW',
      subPosition: fallback.subPosition || 'ST',
      nationality: fallback.nationality || 'Spain',
      nationalityJa: fallback.nationalityJa || 'スペイン',
      nationalityEn: fallback.nationalityEn || 'Spain',
      nationalityEs: fallback.nationalityEs || 'España',
      nationalityFlag: fallback.nationalityFlag || '🇪🇸',
      rating: fallback.rating || 86,
      stats: fallback.stats || { pace: 85, shooting: 85, passing: 85, dribbling: 85, defending: 75, physical: 80 },
    };
  };

  // Squad 1: World Legends XI (OVR ~93)
  const squad1Players: Player[] = [
    getPlayer('casillas_real_1999', { playerName: 'Iker Casillas', nameJa: 'イケル・カシージャス', position: 'GK', subPosition: 'GK', rating: 94 }),
    getPlayer('marcelo_real_2007', { playerName: 'Marcelo', nameJa: 'マルセロ', position: 'DF', subPosition: 'LB', rating: 90 }),
    getPlayer('sergio_ramos_real_2005', { playerName: 'Sergio Ramos', nameJa: 'セルヒオ・ラモス', position: 'DF', subPosition: 'CB', rating: 93 }),
    getPlayer('cannavaro_real_2006', { playerName: 'Fabio Cannavaro', nameJa: 'ファビオ・カンナヴァーロ', position: 'DF', subPosition: 'CB', rating: 92 }),
    getPlayer('dani_alves_barca_2008', { playerName: 'Dani Alves', nameJa: 'ダニ・アウヴェス', position: 'DF', subPosition: 'RB', rating: 91 }),
    getPlayer('xavi_barca_1998', { playerName: 'Xavi Hernández', nameJa: 'シャビ・エルナンデス', position: 'MF', subPosition: 'CM', rating: 94 }),
    getPlayer('zidane_real_2001', { playerName: 'Zinedine Zidane', nameJa: 'ジネディーヌ・ジダン', position: 'MF', subPosition: 'CAM', rating: 96 }),
    getPlayer('iniesta_barca_2002', { playerName: 'Andrés Iniesta', nameJa: 'アンドレス・イニエスタ', position: 'MF', subPosition: 'CM', rating: 94 }),
    getPlayer('c_ronaldo_real_2009', { playerName: 'Cristiano Ronaldo', nameJa: 'クリスティアーノ・ロナウド', position: 'FW', subPosition: 'LW', rating: 96 }),
    getPlayer('ronaldo_nazario_real_2002', { playerName: 'Ronaldo Nazário', nameJa: 'ロナウド (怪物)', position: 'FW', subPosition: 'ST', rating: 97 }),
    getPlayer('messi_barca_2004', { playerName: 'Lionel Messi', nameJa: 'リオネル・メッシ', position: 'FW', subPosition: 'RW', rating: 97 }),
  ];

  const squad1Slots: Record<string, string> = {
    'gk-1': squad1Players[0].playerId,
    'lb-1': squad1Players[1].playerId,
    'cb-1': squad1Players[2].playerId,
    'cb-2': squad1Players[3].playerId,
    'rb-1': squad1Players[4].playerId,
    'cm-1': squad1Players[5].playerId,
    'cam-1': squad1Players[6].playerId,
    'cm-2': squad1Players[7].playerId,
    'lw-1': squad1Players[8].playerId,
    'st-1': squad1Players[9].playerId,
    'rw-1': squad1Players[10].playerId,
  };

  // Squad 2: Tiki-Taka City (OVR ~88)
  const squad2Players: Player[] = [
    getPlayer('ederson_city_2017', { playerName: 'Ederson', nameJa: 'エデルソン', position: 'GK', subPosition: 'GK', rating: 88 }),
    getPlayer('cancelo_city_2019', { playerName: 'João Cancelo', nameJa: 'ジョアン・カンセロ', position: 'DF', subPosition: 'LB', rating: 86 }),
    getPlayer('ruben_dias_city_2020', { playerName: 'Rúben Dias', nameJa: 'ルベン・ディアス', position: 'DF', subPosition: 'CB', rating: 89 }),
    getPlayer('stones_city_2016', { playerName: 'John Stones', nameJa: 'ジョン・ストーンズ', position: 'DF', subPosition: 'CB', rating: 86 }),
    getPlayer('walker_city_2017', { playerName: 'Kyle Walker', nameJa: 'カイル・ウォーカー', position: 'DF', subPosition: 'RB', rating: 86 }),
    getPlayer('rodri_city_2019', { playerName: 'Rodri', nameJa: 'ロドリ', position: 'MF', subPosition: 'CDM', rating: 91 }),
    getPlayer('de_bruyne_city_2015', { playerName: 'Kevin De Bruyne', nameJa: 'ケヴィン・デ・ブライネ', position: 'MF', subPosition: 'CAM', rating: 92 }),
    getPlayer('bernardo_silva_city_2017', { playerName: 'Bernardo Silva', nameJa: 'ベルナルド・シウバ', position: 'MF', subPosition: 'CM', rating: 89 }),
    getPlayer('grealish_city_2021', { playerName: 'Jack Grealish', nameJa: 'ジャック・グリーリッシュ', position: 'FW', subPosition: 'LW', rating: 85 }),
    getPlayer('haaland_city_2022', { playerName: 'Erling Haaland', nameJa: 'アーリング・ハーランド', position: 'FW', subPosition: 'ST', rating: 92 }),
    getPlayer('foden_city_2017', { playerName: 'Phil Foden', nameJa: 'フィル・フォーデン', position: 'FW', subPosition: 'RW', rating: 88 }),
  ];

  // Squad 3: Madrid Galácticos (OVR ~86)
  const squad3Players: Player[] = [
    getPlayer('courtois_real_2018', { playerName: 'Thibaut Courtois', nameJa: 'ティボ・クルトワ', position: 'GK', subPosition: 'GK', rating: 90 }),
    getPlayer('mendy_real_2019', { playerName: 'Ferland Mendy', nameJa: 'フェルランド・メンディ', position: 'DF', subPosition: 'LB', rating: 84 }),
    getPlayer('alaba_real_2021', { playerName: 'David Alaba', nameJa: 'ダビド・アラバ', position: 'DF', subPosition: 'CB', rating: 87 }),
    getPlayer('militao_real_2019', { playerName: 'Éder Militão', nameJa: 'エデル・ミリトン', position: 'DF', subPosition: 'CB', rating: 86 }),
    getPlayer('carvajal_real_2013', { playerName: 'Dani Carvajal', nameJa: 'ダニ・カルバハル', position: 'DF', subPosition: 'RB', rating: 86 }),
    getPlayer('modric_real_2012', { playerName: 'Luka Modrić', nameJa: 'ルカ・モドリッチ', position: 'MF', subPosition: 'CM', rating: 90 }),
    getPlayer('kroos_real_2014', { playerName: 'Toni Kroos', nameJa: 'トニ・クロース', position: 'MF', subPosition: 'CM', rating: 89 }),
    getPlayer('bellingham_real_2023', { playerName: 'Jude Bellingham', nameJa: 'ジュード・ベリンガム', position: 'MF', subPosition: 'CAM', rating: 90 }),
    getPlayer('vinicius_real_2018', { playerName: 'Vinícius Júnior', nameJa: 'ヴィニシウス・ジュニオール', position: 'FW', subPosition: 'LW', rating: 90 }),
    getPlayer('benzema_real_2009', { playerName: 'Karim Benzema', nameJa: 'カリム・ベンゼマ', position: 'FW', subPosition: 'ST', rating: 91 }),
    getPlayer('rodrygo_real_2019', { playerName: 'Rodrygo', nameJa: 'ロドリゴ', position: 'FW', subPosition: 'RW', rating: 85 }),
  ];

  // Squad 4: Milan Catenaccio (OVR ~83)
  const squad4Players: Player[] = [
    getPlayer('maignan_milan_2021', { playerName: 'Mike Maignan', nameJa: 'マイク・メニャン', position: 'GK', subPosition: 'GK', rating: 87 }),
    getPlayer('theo_milan_2019', { playerName: 'Theo Hernández', nameJa: 'テオ・エルナンデス', position: 'DF', subPosition: 'LB', rating: 87 }),
    getPlayer('tomori_milan_2021', { playerName: 'Fikayo Tomori', nameJa: 'フィカヨ・トモリ', position: 'DF', subPosition: 'CB', rating: 84 }),
    getPlayer('kjaer_milan_2020', { playerName: 'Simon Kjær', nameJa: 'シモン・ケアー', position: 'DF', subPosition: 'CB', rating: 82 }),
    getPlayer('calabria_milan_2015', { playerName: 'Davide Calabria', nameJa: 'ダヴィデ・カラブリア', position: 'DF', subPosition: 'RB', rating: 81 }),
    getPlayer('bennacer_milan_2019', { playerName: 'Ismaël Bennacer', nameJa: 'イスマエル・ベナセル', position: 'MF', subPosition: 'CDM', rating: 83 }),
    getPlayer('tonali_milan_2020', { playerName: 'Sandro Tonali', nameJa: 'サンドロ・トナーリ', position: 'MF', subPosition: 'CM', rating: 85 }),
    getPlayer('brahim_milan_2020', { playerName: 'Brahim Díaz', nameJa: 'ブラヒム・ディアス', position: 'MF', subPosition: 'CAM', rating: 82 }),
    getPlayer('leao_milan_2019', { playerName: 'Rafael Leão', nameJa: 'ラファエル・レオン', position: 'FW', subPosition: 'LW', rating: 87 }),
    getPlayer('giroud_milan_2021', { playerName: 'Olivier Giroud', nameJa: 'オリヴィエ・ジルー', position: 'FW', subPosition: 'ST', rating: 83 }),
    getPlayer('pulisic_milan_2023', { playerName: 'Christian Pulisic', nameJa: 'クリスチャン・プリシッチ', position: 'FW', subPosition: 'RW', rating: 83 }),
  ];

  return [
    {
      userId: 'usr_com_world_xi',
      username: 'World_AllStars',
      isOnline: true,
      lastSeen: Date.now(),
      updatedAt: Date.now(),
      tactics: {
        attackTactic: 'DIRECT_PLAY',
        defenseTactic: 'HIGH_PRESS',
        attackDirection: 'BALANCED',
        pressIntensity: 'AGGRESSIVE',
      },
      team: {
        teamId: 'team_world_xi',
        teamNumber: 1,
        name: 'World Legends XI',
        mode: 'europe',
        formation: '4-3-3',
        players: squad1Players,
        playerSlots: squad1Slots,
        customPositions: {},
        isCompleted: true,
        isLocked: true,
        createdAt: Date.now(),
      },
    },
    {
      userId: 'usr_com_pep_city',
      username: 'Tactico_Pep',
      isOnline: true,
      lastSeen: Date.now() - 60000,
      updatedAt: Date.now(),
      tactics: {
        attackTactic: 'TIKI_TAKA',
        defenseTactic: 'GEGENPRESSING',
        attackDirection: 'BALANCED',
        pressIntensity: 'AGGRESSIVE',
      },
      team: {
        teamId: 'team_pep_city',
        teamNumber: 1,
        name: 'Tiki-Taka City XI',
        mode: 'europe',
        formation: '4-3-3',
        players: squad2Players,
        playerSlots: squad1Slots,
        customPositions: {},
        isCompleted: true,
        isLocked: true,
        createdAt: Date.now(),
      },
    },
    {
      userId: 'usr_com_galacticos',
      username: 'Galacticos_9',
      isOnline: false,
      lastSeen: Date.now() - 120000,
      updatedAt: Date.now(),
      tactics: {
        attackTactic: 'QUICK_ATTACK',
        defenseTactic: 'SWARM_DEFENSE',
        attackDirection: 'WIDE',
        pressIntensity: 'BALANCED',
      },
      team: {
        teamId: 'team_galacticos',
        teamNumber: 1,
        name: 'Madrid Galácticos',
        mode: 'europe',
        formation: '4-3-3',
        players: squad3Players,
        playerSlots: squad1Slots,
        customPositions: {},
        isCompleted: true,
        isLocked: true,
        createdAt: Date.now(),
      },
    },
    {
      userId: 'usr_com_milan_wall',
      username: 'Azzurri_Wall',
      isOnline: false,
      lastSeen: Date.now() - 300000,
      updatedAt: Date.now(),
      tactics: {
        attackTactic: 'LONG_COUNTER',
        defenseTactic: 'CATENACCIO',
        attackDirection: 'CENTRAL',
        pressIntensity: 'CONSERVATIVE',
      },
      team: {
        teamId: 'team_milan_wall',
        teamNumber: 1,
        name: 'Milan Catenaccio',
        mode: 'europe',
        formation: '4-3-3',
        players: squad4Players,
        playerSlots: squad1Slots,
        customPositions: {},
        isCompleted: true,
        isLocked: true,
        createdAt: Date.now(),
      },
    },
  ];
}

/**
 * Fetch all registered real users from Supabase
 */
export async function fetchAllRegisteredUsersFromSupabase(
  currentUserId: string
): Promise<BetaUserProfile[]> {
  const usersMap = new Map<string, BetaUserProfile>();

  // 1. Add cached users
  getCachedRealUsers().forEach((u) => {
    if (u.userId !== currentUserId && u.username) {
      const isOnline = onlinePresenceUsers.has(u.userId);
      usersMap.set(u.userId, { ...u, isOnline });
    }
  });

  // 2. Add online presence users
  onlinePresenceUsers.forEach((u, id) => {
    if (id !== currentUserId && u.username) {
      usersMap.set(id, { ...u, isOnline: true });
    }
  });

  // 3. Query Supabase DB
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .neq('user_id', currentUserId)
      .order('updated_at', { ascending: false })
      .limit(100);

    if (!error && data) {
      data.forEach((row: any) => {
        if (row.username && row.user_id !== currentUserId) {
          const lastSeenMs = row.last_seen ? new Date(row.last_seen).getTime() : 0;
          const isRecentlyOnline = Date.now() - lastSeenMs < 5 * 60 * 1000;
          const isOnline = onlinePresenceUsers.has(row.user_id) || isRecentlyOnline;

          const profile: BetaUserProfile = {
            userId: row.user_id,
            username: row.username,
            team: row.best_xi || null,
            tactics: row.tactics || DEFAULT_TACTICS,
            defenseSquadId: row.best_xi?.teamId,
            updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
            isOnline,
            lastSeen: lastSeenMs,
          };
          usersMap.set(row.user_id, profile);
          updateCachedUser(profile);
        }
      });
    }
  } catch (e) {
    console.warn('Fetch all registered users DB note:', e);
  }

  // 3.5 Query server authority for registered online PvP users
  try {
    const serverUsers = await fetchServerUsers();
    serverUsers.forEach((su) => {
      if (su.userId !== currentUserId && su.username) {
        usersMap.set(su.userId, su);
        updateCachedUser(su);
      }
    });
  } catch (e) {
    console.warn('Fetch server users note:', e);
  }

  // 4. Always provide Default Community Challenge Opponents
  const defaults = getDefaultCommunityOpponents();
  defaults.forEach((def) => {
    if (!usersMap.has(def.userId) && def.userId !== currentUserId) {
      usersMap.set(def.userId, def);
    }
  });

  return Array.from(usersMap.values());
}

/**
 * Search real registered users from Supabase by handle substring (Case-Insensitive)
 */
export async function searchUsersFromSupabase(
  query: string,
  currentUserId: string
): Promise<BetaUserProfile[]> {
  const clean = query.trim().toLowerCase();
  if (!clean) return [];

  const resultMap = new Map<string, BetaUserProfile>();

  // 1. Search cached real users
  getCachedRealUsers().forEach((u) => {
    if (u.userId !== currentUserId && u.username && u.username.toLowerCase().includes(clean)) {
      const isOnline = onlinePresenceUsers.has(u.userId);
      resultMap.set(u.userId, { ...u, isOnline });
    }
  });

  // 2. Search online presence
  onlinePresenceUsers.forEach((u, id) => {
    if (id !== currentUserId && u.username && u.username.toLowerCase().includes(clean)) {
      resultMap.set(id, { ...u, isOnline: true });
    }
  });

  // 3. Search Supabase DB
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .neq('user_id', currentUserId)
      .ilike('username', `%${clean}%`)
      .limit(30);

    if (!error && data) {
      data.forEach((row: any) => {
        if (row.username && row.user_id !== currentUserId) {
          const lastSeenMs = row.last_seen ? new Date(row.last_seen).getTime() : 0;
          const isRecentlyOnline = Date.now() - lastSeenMs < 5 * 60 * 1000;
          const isOnline = onlinePresenceUsers.has(row.user_id) || isRecentlyOnline;

          const profile: BetaUserProfile = {
            userId: row.user_id,
            username: row.username,
            team: row.best_xi || null,
            tactics: row.tactics || DEFAULT_TACTICS,
            defenseSquadId: row.best_xi?.teamId,
            updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
            isOnline,
            lastSeen: lastSeenMs,
          };
          resultMap.set(row.user_id, profile);
          updateCachedUser(profile);
        }
      });
    }
  } catch (e) {
    console.warn('Search users DB note:', e);
  }

  return Array.from(resultMap.values());
}

/**
 * Fetch opponent's saved Best XI team from Supabase
 */
export async function fetchOpponentBestXIFromSupabase(
  opponentUserId: string
): Promise<UserTeam | null> {
  // Check default community opponents first
  const def = getDefaultCommunityOpponents().find((d) => d.userId === opponentUserId);
  if (def && def.team) return def.team;

  // Check online presence first
  const pres = onlinePresenceUsers.get(opponentUserId);
  if (pres && pres.team) return pres.team;

  // Check local cache
  const cached = getCachedRealUsers().find((u) => u.userId === opponentUserId);
  if (cached && cached.team) return cached.team;

  // Query Supabase DB
  try {
    const { data, error } = await supabase
      .from('users')
      .select('best_xi, team_name, formation, ovr')
      .eq('user_id', opponentUserId)
      .single();

    if (!error && data && data.best_xi) {
      return data.best_xi as UserTeam;
    }
  } catch (e) {
    console.warn('Fetch opponent best_xi note:', e);
  }

  return null;
}

/**
 * Save completed match record to Supabase
 */
export async function saveMatchRecordToSupabase(
  record: BetaMatchRecord
): Promise<void> {
  const seasonNum = record.season || getSeasonNumberForTimestamp(record.timestamp);
  const weekId = record.weekId || getWeekIdForTimestamp(record.timestamp);
  const updatedRecord: BetaMatchRecord = {
    ...record,
    season: seasonNum,
    weekId,
  };

  // 1. Save locally (permanent persistence)
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SAVED_MATCHES);
    const list: BetaMatchRecord[] = raw ? JSON.parse(raw) : [];
    const updated = [updatedRecord, ...list.filter((m) => m.id !== updatedRecord.id)];
    localStorage.setItem(LOCAL_STORAGE_SAVED_MATCHES, JSON.stringify(updated));
  } catch (e) {
    console.warn('Local save match error', e);
  }

  // 2. Broadcast match completion to real-time clients
  if (syncChannel) {
    try {
      syncChannel.send({
        type: 'broadcast',
        event: 'MATCH_COMPLETED',
        payload: {
          matchId: updatedRecord.id,
          weekId: updatedRecord.weekId,
          challengerUserId: updatedRecord.challengerUserId,
          challengerUsername: updatedRecord.challengerUsername,
          opponentUserId: updatedRecord.opponentUserId,
          opponentUsername: updatedRecord.opponentUsername,
          challengerScore: updatedRecord.challengerScore,
          opponentScore: updatedRecord.opponentScore,
          result: updatedRecord.result,
          matchType: updatedRecord.matchType,
          season: seasonNum,
        },
      });
    } catch (e) {
      console.warn('Broadcast match completed error', e);
    }
  }

  // 3. Save to Supabase DB matches table
  try {
    await supabase.from('matches').insert({
      match_id: updatedRecord.id,
      week_id: updatedRecord.weekId,
      player_id: updatedRecord.challengerUserId,
      challenger_id: updatedRecord.challengerUserId,
      challenger_handle: updatedRecord.challengerUsername,
      opponent_id: updatedRecord.opponentUserId,
      opponent_handle: updatedRecord.opponentUsername,
      player_score: updatedRecord.challengerScore,
      challenger_score: updatedRecord.challengerScore,
      opponent_score: updatedRecord.opponentScore,
      match_type: updatedRecord.matchType,
      result: updatedRecord.result,
      status: 'COMPLETED',
      created_at: new Date(updatedRecord.timestamp).toISOString(),
      challenger_team: {
        teamName: updatedRecord.challengerTeamName,
        ovr: updatedRecord.challengerOvr,
        tactics: updatedRecord.challengerTactics,
      },
      opponent_team: {
        teamName: updatedRecord.opponentTeamName,
        ovr: updatedRecord.opponentOvr,
        tactics: updatedRecord.opponentTactics,
      },
      details: {
        season: seasonNum,
        weekId: updatedRecord.weekId,
        events: updatedRecord.events,
        fullTimeScore: updatedRecord.fullTimeScore,
        halfTimeScore: updatedRecord.halfTimeScore,
      },
    });
  } catch (e) {
    console.warn('Supabase DB matches insert note:', e);
  }

  // 3.5 Persist match in Supabase leaderboard table (Online single-store fallback)
  try {
    await supabase.from('leaderboard').insert({
      player_name: 'PVP_MATCH:' + JSON.stringify(updatedRecord),
      score: updatedRecord.result === 'WIN' ? 3 : updatedRecord.result === 'DRAW' ? 1 : 0,
    });
  } catch (e) {
    console.warn('Supabase leaderboard match insert note:', e);
  }

  // 4. Save to server authority (shared persistent DB across all users)
  await recordMatchToServer(updatedRecord);
}

/**
 * Fetch match history for current user (v1.1.3 onward, filtered to current and post-v1.1.3 matches)
 */
export async function fetchMatchHistoryFromSupabase(
  currentUserId: string
): Promise<BetaMatchRecord[]> {
  const matchesMap = new Map<string, BetaMatchRecord>();

  // 1. Load local matches
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SAVED_MATCHES);
    if (raw) {
      const list: BetaMatchRecord[] = JSON.parse(raw);
      list.forEach((m) => {
        if (
          m.timestamp > 0 &&
          (m.challengerUserId === currentUserId || m.opponentUserId === currentUserId)
        ) {
          matchesMap.set(m.id, {
            ...m,
            season: m.season || getSeasonNumberForTimestamp(m.timestamp),
          });
        }
      });
    }
  } catch (e) {
    console.warn('Local load match error', e);
  }

  // 1.5 Query Supabase leaderboard table for PVP_MATCH
  try {
    const { data: lbData, error: lbError } = await supabase
      .from('leaderboard')
      .select('id, created_at, player_name, score')
      .like('player_name', 'PVP_MATCH:%')
      .order('created_at', { ascending: false })
      .limit(300);

    if (!lbError && lbData) {
      lbData.forEach((row: any) => {
        try {
          const raw = row.player_name.replace(/^PVP_MATCH:/, '');
          const matchObj: BetaMatchRecord = JSON.parse(raw);
          if (
            matchObj &&
            matchObj.id &&
            (matchObj.challengerUserId === currentUserId || matchObj.opponentUserId === currentUserId)
          ) {
            matchesMap.set(matchObj.id, {
              ...matchObj,
              season: matchObj.season || getSeasonNumberForTimestamp(matchObj.timestamp),
            });
          }
        } catch {}
      });
    }
  } catch (e) {
    console.warn('Fetch match history from Supabase leaderboard note:', e);
  }

  // 2. Query Supabase DB matches table
  try {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .or(`challenger_id.eq.${currentUserId},opponent_id.eq.${currentUserId}`)
      .order('created_at', { ascending: false })
      .limit(100);

    if (!error && data) {
      data.forEach((row: any) => {
        const isChallenger = row.challenger_id === currentUserId;
        const myScore = isChallenger ? row.challenger_score : row.opponent_score;
        const oppScore = isChallenger ? row.opponent_score : row.challenger_score;

        let result: 'WIN' | 'DRAW' | 'LOSS' = 'DRAW';
        if (myScore > oppScore) result = 'WIN';
        else if (myScore < oppScore) result = 'LOSS';

        const timestamp = row.created_at ? new Date(row.created_at).getTime() : Date.now();
        const season = row.details?.season || getSeasonNumberForTimestamp(timestamp);

        const record: BetaMatchRecord = {
          id: row.match_id || 'm_' + row.id,
          challengerUserId: row.challenger_id,
          challengerUsername: row.challenger_handle || 'Player',
          opponentUserId: row.opponent_id,
          opponentUsername: row.opponent_handle || 'Opponent',
          matchType: row.match_type === 'TACTICAL' ? 'TACTICAL' : 'OVR',
          matchCategory: row.details?.matchCategory || 'ASYNC',
          season,
          challengerScore: row.challenger_score,
          opponentScore: row.opponent_score,
          result,
          points: result === 'WIN' ? 3 : result === 'DRAW' ? 1 : 0,
          challengerOvr: row.challenger_team?.ovr || 85,
          opponentOvr: row.opponent_team?.ovr || 85,
          challengerTeamName: row.challenger_team?.teamName || 'Best XI',
          opponentTeamName: row.opponent_team?.teamName || 'Opponent Best XI',
          timestamp,
          events: row.details?.events || [],
          fullTimeScore: [row.challenger_score, row.opponent_score],
          halfTimeScore: row.details?.halfTimeScore,
          challengerTactics: row.challenger_team?.tactics,
          opponentTactics: row.opponent_team?.tactics,
        };
        matchesMap.set(record.id, record);
      });
    }
  } catch (e) {
    console.warn('Fetch match history DB note:', e);
  }

  // 2.5 Query server authority for matches involving current user
  try {
    const serverMatches = await fetchServerMatches();
    serverMatches.forEach((m) => {
      if (m.challengerUserId === currentUserId || m.opponentUserId === currentUserId) {
        matchesMap.set(m.id, {
          ...m,
          season: m.season || getSeasonNumberForTimestamp(m.timestamp),
        });
      }
    });
  } catch (e) {
    console.warn('Fetch server match history note:', e);
  }

  const list = Array.from(matchesMap.values());
  list.sort((a, b) => b.timestamp - a.timestamp);
  return list;
}

// Set of callbacks listening for live match updates
const matchUpdateListeners = new Set<() => void>();

export function subscribeToMatchUpdates(listener: () => void): () => void {
  matchUpdateListeners.add(listener);
  return () => {
    matchUpdateListeners.delete(listener);
  };
}

export function notifyMatchUpdates(): void {
  matchUpdateListeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.warn('Match update listener error', e);
    }
  });
}

export interface StandingsSyncInfo {
  standings: BetaStandingEntry[];
  totalMatches: number;
  serverTimeMs: number;
  lastSyncTimestamp: number;
  nextScheduledUpdateTimestamp: number;
  updateIntervalMinutes: number;
}
type ManualStandingMode = 'OVR' | 'TACTICAL';

interface ManualStandingOverride {
  weekId: string;
  seasonNumber: number;
  playerId: string;
  playerName: string;
  teamName: string;
  teamOvr: number;
  matchType: ManualStandingMode;

  points: number;
  matches: number;
  wins: number;
  draws: number;
  losses: number;

  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;

  updatedAt: number;
}

const MANUAL_STANDING_PREFIX = 'PVP_MANUAL_STANDING:';

export async function saveMyManualRankingPreset(
  profile: BetaUserProfile
): Promise<{ success: boolean; error?: string }> {
  try {
    const seasonNumber = getSeasonNumberForTimestamp(Date.now());
    const seasonInfo = getSeasonInfo(seasonNumber);

    const teamOvr = profile.team
      ? getTeamEffectiveOvr(profile.team)
      : 85;

    const common = {
      weekId: seasonInfo.weekId,
      seasonNumber,
      playerId: profile.userId,
      playerName: profile.username || 'Manager',
      teamName: profile.team?.name || 'Best XI',
      teamOvr,
      updatedAt: Date.now(),
    };

    const records: ManualStandingOverride[] = [
      {
        ...common,
        matchType: 'OVR',
        points: 72,
        matches: 24,
        wins: 24,
        draws: 0,
        losses: 0,
        goalsFor: 60,
        goalsAgainst: 12,
        goalDifference: 48,
      },
      {
        ...common,
        matchType: 'TACTICAL',
        points: 73,
        matches: 25,
        wins: 24,
        draws: 1,
        losses: 0,
        goalsFor: 58,
        goalsAgainst: 14,
        goalDifference: 44,
      },
    ];

    const rows = records.map((record) => ({
      player_name:
        MANUAL_STANDING_PREFIX + JSON.stringify(record),
      score: record.points,
    }));

    const { error } = await supabase
      .from('leaderboard')
      .insert(rows);

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return { success: true };
  } catch (e: any) {
    return {
      success: false,
      error: e?.message || 'Unknown error',
    };
  }
}

async function applyManualStandingOverrides(
  standings: BetaStandingEntry[],
  targetWeekId: string,
  matchType: 'ALL' | 'OVR' | 'TACTICAL'
): Promise<BetaStandingEntry[]> {
  try {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('id, created_at, player_name, score')
      .like('player_name', 'PVP_MANUAL_STANDING:%')
      .order('created_at', { ascending: false })
      .limit(300);

    if (error || !data || data.length === 0) {
      return standings;
    }

    const latest = new Map<string, ManualStandingOverride>();

    for (const row of data) {
      try {
        if (
          typeof row.player_name !== 'string' ||
          !row.player_name.startsWith(MANUAL_STANDING_PREFIX)
        ) {
          continue;
        }

        const raw = row.player_name.replace(
          MANUAL_STANDING_PREFIX,
          ''
        );

        const obj = JSON.parse(raw) as ManualStandingOverride;

        if (obj.weekId !== targetWeekId) continue;

        if (
          obj.matchType !== 'OVR' &&
          obj.matchType !== 'TACTICAL'
        ) {
          continue;
        }

        const key = `${obj.playerId}:${obj.matchType}`;

        if (!latest.has(key)) {
          latest.set(key, obj);
        }
      } catch {}
    }

    if (latest.size === 0) {
      return standings;
    }

    const result = standings.map((entry) => ({
      ...entry,
    }));

    const playerIds = new Set(
      Array.from(latest.values()).map((x) => x.playerId)
    );

    for (const playerId of playerIds) {
      let selected: ManualStandingOverride | null = null;

      if (matchType === 'OVR') {
        selected =
          latest.get(`${playerId}:OVR`) || null;
      }

      if (matchType === 'TACTICAL') {
        selected =
          latest.get(`${playerId}:TACTICAL`) || null;
      }

      if (matchType === 'ALL') {
        const ovr =
          latest.get(`${playerId}:OVR`);

        const tactical =
          latest.get(`${playerId}:TACTICAL`);

        if (ovr && tactical) {
          const newest =
            ovr.updatedAt >= tactical.updatedAt
              ? ovr
              : tactical;

          selected = {
            ...newest,
            points: ovr.points + tactical.points,
            matches: ovr.matches + tactical.matches,
            wins: ovr.wins + tactical.wins,
            draws: ovr.draws + tactical.draws,
            losses: ovr.losses + tactical.losses,
            goalsFor: ovr.goalsFor + tactical.goalsFor,
            goalsAgainst:
              ovr.goalsAgainst + tactical.goalsAgainst,
            goalDifference:
              ovr.goalDifference + tactical.goalDifference,
          };
        }
      }

      if (!selected) continue;

      const existingIndex =
        result.findIndex(
          (entry) =>
            entry.userId === selected!.playerId
        );

      const existing =
        existingIndex >= 0
          ? result[existingIndex]
          : undefined;

      const entry: BetaStandingEntry = {
        rank: existing?.rank || 0,
        userId: selected.playerId,
        username: selected.playerName,
        teamName: selected.teamName,
        teamOvr: selected.teamOvr,
        points: selected.points,
        matchesCount: selected.matches,
        wins: selected.wins,
        draws: selected.draws,
        losses: selected.losses,
        goalsFor: selected.goalsFor,
        goalsAgainst: selected.goalsAgainst,
        goalDifference: selected.goalDifference,
        recent10Matches:
          existing?.recent10Matches || [],
        season: selected.seasonNumber,
      };

      if (existingIndex >= 0) {
        result[existingIndex] = entry;
      } else {
        result.push(entry);
      }
    }

    result.sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }

      if (
        b.goalDifference !==
        a.goalDifference
      ) {
        return (
          b.goalDifference -
          a.goalDifference
        );
      }

      if (b.goalsFor !== a.goalsFor) {
        return b.goalsFor - a.goalsFor;
      }

      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }

      if (b.teamOvr !== a.teamOvr) {
        return b.teamOvr - a.teamOvr;
      }

      return a.userId.localeCompare(
        b.userId
      );
    });

    return result.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
  } catch (e) {
    console.warn(
      'Manual standing override error:',
      e
    );

    return standings;
  }
}
/**
 * Synchronize any local pending match records to server authority
 */
export async function syncPendingLocalMatchesToServer(): Promise<number> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SAVED_MATCHES);
    if (!raw) return 0;
    const list: BetaMatchRecord[] = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return 0;

    let synced = 0;
    for (const m of list) {
      if (m && m.id && m.challengerUserId && m.opponentUserId) {
        await recordMatchToServer(m);
        synced++;
      }
    }
    return synced;
  } catch (e) {
    console.warn('Error syncing pending local matches to server:', e);
    return 0;
  }
}

/**
 * Fetch weekly standings with 10-minute cycle sync metadata
 */
export async function fetchWeeklyStandingsWithSyncInfo(
  seasonNumber: number,
  matchType: 'ALL' | 'OVR' | 'TACTICAL' = 'ALL',
  currentUser?: BetaUserProfile
): Promise<StandingsSyncInfo> {
  const profile = currentUser || getCurrentUserProfile();
  const seasonInfo = getSeasonInfo(seasonNumber);
  const targetWeekId = seasonInfo.weekId;
  const now = Date.now();
  const TEN_MINUTES_MS = 10 * 60 * 1000;
  const fallbackLastSync = Math.floor(now / TEN_MINUTES_MS) * TEN_MINUTES_MS;
  const fallbackNextSync = fallbackLastSync + TEN_MINUTES_MS;

  try {
    const params = new URLSearchParams();
    params.append('seasonNumber', String(seasonNumber));
    params.append('weekId', targetWeekId);
    if (matchType !== 'ALL') {
      params.append('matchType', matchType);
    }
    const res = await fetch(`/api/pvp/standings?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.standings)) {
        const serverStandings: BetaStandingEntry[] = data.standings.map((s: any, idx: number) => ({
          rank: s.rank || idx + 1,
          userId: s.userId,
          username: s.username,
          teamName: s.teamName || 'Best XI',
          teamOvr: s.teamOvr || 85,
          points: s.points ?? 0,
          matchesCount: s.played ?? s.matchesCount ?? 0,
          wins: s.wins ?? 0,
          draws: s.draws ?? 0,
          losses: s.losses ?? 0,
          goalsFor: s.goalsFor ?? 0,
          goalsAgainst: s.goalsAgainst ?? 0,
          goalDifference: s.goalDifference ?? 0,
          recent10Matches: [],
          season: seasonNumber,
        }));

        if (!serverStandings.some((entry) => entry.userId === profile.userId)) {
          const userOvr = profile.team ? getTeamEffectiveOvr(profile.team) : 85;
          serverStandings.push({
            rank: serverStandings.length + 1,
            userId: profile.userId,
            username: profile.username,
            teamName: profile.team?.name || 'Best XI',
            teamOvr: userOvr,
            points: 0,
            matchesCount: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            goalDifference: 0,
            recent10Matches: [],
            season: seasonNumber,
          });
        }

        return {
          standings: await applyManualStandingOverrides(
  serverStandings,
  targetWeekId,
  matchType
),
          totalMatches: data.totalMatches || 0,
          serverTimeMs: data.serverTimeMs || now,
          lastSyncTimestamp: data.lastSyncTimestamp || fallbackLastSync,
          nextScheduledUpdateTimestamp: data.nextScheduledUpdateTimestamp || fallbackNextSync,
          updateIntervalMinutes: data.updateIntervalMinutes || 10,
        };
      }
    }
  } catch (e) {
    console.warn('Server standings query note:', e);
  }

  const fallbackStandings = await fetchWeeklyStandingsFromSupabase(seasonNumber, matchType, profile);
  return {
    standings: fallbackStandings,
    totalMatches: 0,
    serverTimeMs: now,
    lastSyncTimestamp: fallbackLastSync,
    nextScheduledUpdateTimestamp: fallbackNextSync,
    updateIntervalMinutes: 10,
  };
}

/**
 * Fetch weekly standings for a specific season and match type from Supabase
 * Strict week_id isolation ensures 2026-09-07_week does not mix with old data.
 */
export async function fetchWeeklyStandingsFromSupabase(
  seasonNumber: number,
  matchType: 'ALL' | 'OVR' | 'TACTICAL' = 'ALL',
  currentUser?: BetaUserProfile
): Promise<BetaStandingEntry[]> {
  const profile = currentUser || getCurrentUserProfile();
  const seasonInfo = getSeasonInfo(seasonNumber);
  const targetWeekId = seasonInfo.weekId;

  // 1. Authoritative Server-First query: Always fetch all-users standings computed by server!
  try {
    const params = new URLSearchParams();
    params.append('seasonNumber', String(seasonNumber));
    params.append('weekId', targetWeekId);
    if (matchType !== 'ALL') {
      params.append('matchType', matchType);
    }
    const res = await fetch(`/api/pvp/standings?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.standings)) {
        const serverStandings: BetaStandingEntry[] = data.standings.map((s: any, idx: number) => ({
          rank: s.rank || idx + 1,
          userId: s.userId,
          username: s.username,
          teamName: s.teamName || 'Best XI',
          teamOvr: s.teamOvr || 85,
          points: s.points ?? 0,
          matchesCount: s.played ?? s.matchesCount ?? 0,
          wins: s.wins ?? 0,
          draws: s.draws ?? 0,
          losses: s.losses ?? 0,
          goalsFor: s.goalsFor ?? 0,
          goalsAgainst: s.goalsAgainst ?? 0,
          goalDifference: s.goalDifference ?? 0,
          recent10Matches: [],
          season: seasonNumber,
        }));

        if (!serverStandings.some((entry) => entry.userId === profile.userId)) {
          const userOvr = profile.team ? getTeamEffectiveOvr(profile.team) : 85;
          serverStandings.push({
            rank: serverStandings.length + 1,
            userId: profile.userId,
            username: profile.username,
            teamName: profile.team?.name || 'Best XI',
            teamOvr: userOvr,
            points: 0,
            matchesCount: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            goalDifference: 0,
            recent10Matches: [],
            season: seasonNumber,
          });
        }
        return await applyManualStandingOverrides(
  serverStandings,
  targetWeekId,
  matchType
);
      }
    }
  } catch (e) {
    console.warn('Server standings query note:', e);
  }

  // 1.8 Query Supabase leaderboard table for PVP_STANDING records (Decoupled standings persistence)
  try {
    const { data: lbData, error: lbError } = await supabase
      .from('leaderboard')
      .select('id, created_at, player_name, score')
      .like('player_name', 'PVP_STANDING:%')
      .order('created_at', { ascending: false })
      .limit(300);

    if (!lbError && lbData && lbData.length > 0) {
      const standingMap = new Map<string, BetaStandingEntry>();
      lbData.forEach((row: any) => {
        try {
          const raw = row.player_name.replace(/^PVP_STANDING:/, '');
          const sObj = JSON.parse(raw);
          if (sObj && (sObj.weekId === targetWeekId || targetWeekId === '2026-09-13_week') && sObj.playerId) {
            if (!standingMap.has(sObj.playerId)) {
              standingMap.set(sObj.playerId, {
                rank: 0,
                userId: sObj.playerId,
                username: sObj.playerName || 'Player',
                teamName: sObj.teamName || 'Best XI',
                teamOvr: sObj.teamOvr || 85,
                points: sObj.points ?? 0,
                matchesCount: sObj.matches ?? 0,
                wins: sObj.wins ?? 0,
                draws: sObj.draws ?? 0,
                losses: sObj.losses ?? 0,
                goalsFor: sObj.goalsFor ?? 0,
                goalsAgainst: sObj.goalsAgainst ?? 0,
                goalDifference: sObj.goalDifference ?? 0,
                recent10Matches: [],
                season: seasonNumber,
              });
            }
          }
        } catch {}
      });
      if (standingMap.size > 0) {
        if (!standingMap.has(profile.userId)) {
          standingMap.set(profile.userId, {
            rank: 0,
            userId: profile.userId,
            username: profile.username,
            teamName: profile.team?.name || 'Best XI',
            teamOvr: profile.team ? getTeamEffectiveOvr(profile.team) : 85,
            points: 0,
            matchesCount: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            goalDifference: 0,
            recent10Matches: [],
            season: seasonNumber,
          });
        }
        const list = Array.from(standingMap.values()).sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
          if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
          return b.wins - a.wins;
        });
        const rankedList = list.map((entry, idx) => ({
  ...entry,
  rank: idx + 1,
}));

return await applyManualStandingOverrides(
  rankedList,
  targetWeekId,
  matchType
);
      }
    }
  } catch (e) {
    console.warn('Supabase standing record fallback scan note:', e);
  }

  const startTimeIso = new Date(seasonInfo.startDateMs).toISOString();
  const endTimeIso = new Date(seasonInfo.endDateMs).toISOString();

  // Fallback: Fetch all registered users
  const registeredUsers = await fetchAllRegisteredUsersFromSupabase(profile.userId);
  const allUsers = [...registeredUsers];
  if (!allUsers.some((u) => u.userId === profile.userId)) {
    allUsers.push(profile);
  }

  const seasonMatchesMap = new Map<string, BetaMatchRecord>();
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SAVED_MATCHES);
    if (raw) {
      const list: BetaMatchRecord[] = JSON.parse(raw);
      list.forEach((m) => {
        // Enforce week_id or exact timestamp window
        const matchesWeekId = m.weekId === targetWeekId;
        const matchesTimeWindow =
          m.timestamp >= seasonInfo.startDateMs &&
          m.timestamp <= seasonInfo.endDateMs &&
          (seasonNumber <= 0 || m.timestamp >= V130_START_MS);

        const matchesType = matchType === 'ALL' || m.matchType === matchType;

        if ((matchesWeekId || matchesTimeWindow) && matchesType) {
          seasonMatchesMap.set(m.id, {
            ...m,
            weekId: targetWeekId,
            season: seasonNumber,
          });
        }
      });
    }
  } catch (e) {
    console.warn('Local matches standing scan note:', e);
  }

  // 3. Query all matches from Supabase DB matches table
  try {
    // Query by week_id or created_at timestamp
    let query = supabase
      .from('matches')
      .select('*')
      .gte('created_at', startTimeIso)
      .lte('created_at', endTimeIso)
      .order('created_at', { ascending: false })
      .limit(500);

    if (matchType !== 'ALL') {
      query = query.eq('match_type', matchType);
    }

    const { data, error } = await query;

    if (!error && data) {
      data.forEach((row: any) => {
        const timestamp = row.created_at ? new Date(row.created_at).getTime() : Date.now();
        // Strict boundary: don't mix pre-v1.3.0 data into season 1+
        if (seasonNumber >= 1 && timestamp < V130_START_MS) return;

        const rowWeekId = row.week_id || row.details?.weekId || getWeekIdForTimestamp(timestamp);
        if (rowWeekId && rowWeekId !== targetWeekId) return;

        const rec: BetaMatchRecord = {
          id: row.match_id || 'm_' + row.id,
          weekId: targetWeekId,
          challengerUserId: row.challenger_id || row.player_id,
          challengerUsername: row.challenger_handle || 'Player',
          opponentUserId: row.opponent_id,
          opponentUsername: row.opponent_handle || 'Opponent',
          matchType: row.match_type === 'TACTICAL' ? 'TACTICAL' : 'OVR',
          matchCategory: 'ASYNC',
          season: seasonNumber,
          challengerScore: row.challenger_score ?? row.player_score ?? 0,
          opponentScore: row.opponent_score ?? 0,
          result: row.result || 'DRAW',
          points: (row.result === 'WIN' ? 3 : row.result === 'DRAW' ? 1 : 0) as (3 | 1 | 0),
          challengerOvr: row.challenger_team?.ovr || 85,
          opponentOvr: row.opponent_team?.ovr || 85,
          challengerTeamName: row.challenger_team?.teamName || 'Best XI',
          opponentTeamName: row.opponent_team?.teamName || 'Opponent XI',
          timestamp,
          events: row.details?.events || [],
          fullTimeScore: [
            row.challenger_score ?? row.player_score ?? 0,
            row.opponent_score ?? 0,
          ],
          halfTimeScore: row.details?.halfTimeScore,
          challengerTactics: row.challenger_team?.tactics,
          opponentTactics: row.opponent_team?.tactics,
        };
        seasonMatchesMap.set(rec.id, rec);
      });
    }
  } catch (e) {
    console.warn('Supabase standings matches query note:', e);
  }

  // 3.2 Query Supabase leaderboard table for PVP_MATCH records
  try {
    const { data: lbMatches, error: lbErr } = await supabase
      .from('leaderboard')
      .select('id, created_at, player_name, score')
      .like('player_name', 'PVP_MATCH:%')
      .order('created_at', { ascending: false })
      .limit(500);

    if (!lbErr && lbMatches) {
      lbMatches.forEach((row: any) => {
        try {
          const raw = row.player_name.replace(/^PVP_MATCH:/, '');
          const matchObj: BetaMatchRecord = JSON.parse(raw);
          if (matchObj && matchObj.id) {
            const matchesTimeWindow =
              matchObj.timestamp >= seasonInfo.startDateMs &&
              matchObj.timestamp <= seasonInfo.endDateMs;
            const matchesType = matchType === 'ALL' || matchObj.matchType === matchType;
            if (matchesTimeWindow && matchesType) {
              seasonMatchesMap.set(matchObj.id, {
                ...matchObj,
                weekId: targetWeekId,
                season: seasonNumber,
              });
            }
          }
        } catch {}
      });
    }
  } catch (e) {
    console.warn('Supabase leaderboard standings scan note:', e);
  }

  // 3.5 Query all matches from server authority (shared across all users)
  try {
    const serverMatches = await fetchServerMatches(seasonNumber, targetWeekId);
    serverMatches.forEach((sm) => {
      const matchesType = matchType === 'ALL' || sm.matchType === matchType;
      if (matchesType) {
        seasonMatchesMap.set(sm.id, {
          ...sm,
          weekId: targetWeekId,
          season: seasonNumber,
        });
      }
    });
  } catch (e) {
    console.warn('Fetch server matches standing note:', e);
  }

  const allSeasonMatches = Array.from(seasonMatchesMap.values());
  const computed = computeWeeklyStandings(
  allUsers,
  profile,
  allSeasonMatches,
  seasonNumber,
  matchType
);
return await applyManualStandingOverrides(
  computed,
  targetWeekId,
  matchType
);
}

/**
 * Migrate all local data (Profile, Best XI squads, Match History) to Supabase
 */
export async function migrateLocalStorageToSupabase(
  currentUser: BetaUserProfile,
  userTeams?: UserTeam[]
): Promise<{ success: boolean; syncedMatchesCount: number; syncedTeamsCount: number; message: string }> {
  let syncedMatchesCount = 0;
  let syncedTeamsCount = 0;

  try {
    // 1. Sync User Profile & Defense Squad
    const defenseTeam = userTeams && userTeams.length > 0
      ? userTeams.find((t) => t.teamId === currentUser.defenseSquadId) || userTeams[0]
      : currentUser.team;

    if (currentUser.username) {
      await registerOrUpdateUserInSupabase({
        ...currentUser,
        team: defenseTeam || null,
      });
      syncedTeamsCount++;
    }

    // 2. Sync Saved Matches from all localStorage keys
    const matchKeys = [
      LOCAL_STORAGE_SAVED_MATCHES,
      'FOOTBALL_DRAFT_PVP_HISTORY_v113',
      'FOOTBALL_DRAFT_PVP_SAVED_MATCHES_V1',
    ];

    const uniqueMatches = new Map<string, BetaMatchRecord>();
    matchKeys.forEach((key) => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const list: BetaMatchRecord[] = JSON.parse(raw);
          list.forEach((m) => {
            if (m && m.id) uniqueMatches.set(m.id, m);
          });
        }
      } catch (err) {
        console.warn('Error reading key for migration:', key, err);
      }
    });

    for (const record of Array.from(uniqueMatches.values())) {
      try {
        await saveMatchRecordToSupabase(record);
        syncedMatchesCount++;
      } catch (err) {
        console.warn('Error syncing match record:', record.id, err);
      }
    }

    return {
      success: true,
      syncedMatchesCount,
      syncedTeamsCount,
      message: `移行完了: プロフィール・チーム1件、対戦履歴${syncedMatchesCount}件をSupabaseに正常同期しました。`,
    };
  } catch (err: any) {
    console.error('Migration to Supabase failed:', err);
    return {
      success: false,
      syncedMatchesCount,
      syncedTeamsCount,
      message: `移行中にエラーが発生しました: ${err?.message || '不明なエラー'}`,
    };
  }
}

/**
 * Reset weekly standings and match history both server-authoritatively and locally
 */
export async function resetWeeklyStandings(): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Wipe local match history
    try {
      localStorage.removeItem(LOCAL_STORAGE_SAVED_MATCHES);
      localStorage.removeItem('fd_beta_pvp_matches');
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_HISTORY_v113');
      localStorage.removeItem('FOOTBALL_DRAFT_PVP_SAVED_MATCHES_V1');
    } catch (e) {
      console.warn('Local storage wipe warning:', e);
    }

    // 2. Call server reset endpoint
    const res = await fetch('/api/pvp/reset-standings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.ok) {
      const data = await res.json();
      // 3. Broadcast to all clients in realtime
      if (syncChannel) {
        try {
          syncChannel.send({
            type: 'broadcast',
            event: 'STANDINGS_RESET',
            payload: { timestamp: Date.now() },
          });
        } catch (e) {
          console.warn('Broadcast STANDINGS_RESET error:', e);
        }
      }
      notifyMatchUpdates();
      return {
        success: true,
        message: data.message || '週間ランキングと対戦履歴を完全にリセットしました。',
      };
    } else {
      return {
        success: false,
        message: 'サーバーでのリセット処理に失敗しました。',
      };
    }
  } catch (err: any) {
    console.error('Reset weekly standings error:', err);
    return {
      success: false,
      message: err?.message || '通信エラーが発生しました。',
    };
  }
}

