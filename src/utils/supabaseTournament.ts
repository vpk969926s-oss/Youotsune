import { supabase } from './supabase';
import {
  TournamentDefinition,
  TournamentEntry,
  TournamentGroup,
  TournamentStanding,
  TournamentMatch,
  TournamentKnockoutBracket,
  TournamentRewardGrant,
  TournamentState,
  TournamentStatus,
} from '../types/tournament';
import { UserTeam, TeamTactics } from '../types';
import {
  INITIAL_TOURNAMENT_FD_CUP_001,
  STORAGE_KEY_TOURNAMENT_STATE_CACHE,
  determineTournamentStatus,
  getSavedTournamentTactics,
  saveTournamentTactics,
  partitionIntoGroups,
  calculateStandings,
  generateRoundRobinMatches,
  simulateTournamentMatch,
  buildKnockoutMatches,
} from './tournamentEngine';
import { getPersistentUserId, getSavedUserHandle } from './supabasePvP';

const TOURNAMENT_CHANNEL_NAME = 'official_tournament_FD_CUP_001';
let tournamentChannel: any = null;
let pollingInterval: any = null;
const stateChangeListeners = new Set<(state: TournamentState) => void>();

export function sanitizeTournamentEntry(raw: any): TournamentEntry {
  return {
    tournamentId: raw?.tournamentId || 'FD_CUP_001',
    userId: raw?.userId || 'unknown_user',
    displayName: raw?.displayName || 'Manager',
    entryStatus: raw?.entryStatus || 'ENTERED',
    enteredAt: typeof raw?.enteredAt === 'number' ? raw.enteredAt : (typeof raw?.joinedAt === 'number' ? raw.joinedAt : Date.now()),
    teamSnapshot: raw?.teamSnapshot || {
      teamId: `team_${raw?.userId || 'default'}`,
      name: raw?.displayName ? `${raw.displayName} FC` : 'Tournament Squad',
      formation: '4-3-3',
      players: [],
    },
    tacticsSnapshot: {
      attackTactic: raw?.tacticsSnapshot?.attackTactic || 'POSSESSION',
      defenseTactic: raw?.tacticsSnapshot?.defenseTactic || 'MID_BLOCK',
      attackDirection: raw?.tacticsSnapshot?.attackDirection || 'BALANCED',
      pressIntensity: raw?.tacticsSnapshot?.pressIntensity || 'BALANCED',
    },
    defensiveSquadSnapshot: raw?.defensiveSquadSnapshot,
    teamOvr: typeof raw?.teamOvr === 'number' && !isNaN(raw.teamOvr) ? raw.teamOvr : 85,
    tacticsModifiedCount: typeof raw?.tacticsModifiedCount === 'number' ? raw.tacticsModifiedCount : 0,
  };
}

export function sanitizeTournamentState(raw: any): TournamentState {
  const baseDef = { ...INITIAL_TOURNAMENT_FD_CUP_001 };
  if (!raw || typeof raw !== 'object') {
    return {
      definition: baseDef,
      entries: [],
      groups: [],
      standings: [],
      matches: [],
      knockoutBracket: undefined,
      rewards: [],
      currentServerTimeMs: Date.now(),
    };
  }

  const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
  const cleanEntries = rawEntries.filter(Boolean).map(sanitizeTournamentEntry);

  const rawStandings = Array.isArray(raw.standings) ? raw.standings : [];
  const cleanStandings = rawStandings.filter(Boolean).map((st: any, idx: number) => ({
    userId: st?.userId || `st_${idx}`,
    displayName: st?.displayName || 'Manager',
    teamOvr: typeof st?.teamOvr === 'number' ? st.teamOvr : 85,
    matchesPlayed: st?.matchesPlayed ?? 0,
    wins: st?.wins ?? 0,
    draws: st?.draws ?? 0,
    losses: st?.losses ?? 0,
    goalsFor: st?.goalsFor ?? 0,
    goalsAgainst: st?.goalsAgainst ?? 0,
    goalDifference: typeof st?.goalDifference === 'number' ? st.goalDifference : ((st?.goalsFor ?? 0) - (st?.goalsAgainst ?? 0)),
    points: st?.points ?? 0,
    rank: st?.rank ?? idx + 1,
    isQualified: Boolean(st?.isQualified),
  }));

  const rawMatches = Array.isArray(raw.matches) ? raw.matches : [];
  const cleanMatches = rawMatches.filter(Boolean).map((m: any) => ({
    ...m,
    matchId: m?.matchId || `mat_${Math.random().toString(36).substring(2, 8)}`,
    homeDisplayName: m?.homeDisplayName || 'Home',
    awayDisplayName: m?.awayDisplayName || 'Away',
    homeScore: typeof m?.homeScore === 'number' ? m.homeScore : 0,
    awayScore: typeof m?.awayScore === 'number' ? m.awayScore : 0,
    events: Array.isArray(m?.events) ? m.events.filter(Boolean) : [],
    stageNameJa: m?.stageNameJa || '公式戦',
  }));

  return {
    definition: {
      ...baseDef,
      ...(raw.definition || {}),
      entryCount: cleanEntries.length,
    },
    entries: cleanEntries,
    groups: Array.isArray(raw.groups) ? raw.groups.filter(Boolean) : [],
    standings: cleanStandings,
    matches: cleanMatches,
    knockoutBracket: raw.knockoutBracket || undefined,
    rewards: Array.isArray(raw.rewards) ? raw.rewards.filter(Boolean) : [],
    currentServerTimeMs: typeof raw.currentServerTimeMs === 'number' ? raw.currentServerTimeMs : Date.now(),
  };
}

// In-memory runtime state for fast client UI responsiveness
let currentTournamentState: TournamentState = {
  definition: { ...INITIAL_TOURNAMENT_FD_CUP_001 },
  entries: [],
  groups: [],
  standings: [],
  matches: [],
  knockoutBracket: undefined,
  rewards: [],
  currentServerTimeMs: Date.now(),
};

export function getCurrentTournamentState(): TournamentState {
  return currentTournamentState;
}

/**
 * Load cached state from storage
 */
export function loadCachedTournamentState(): TournamentState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TOURNAMENT_STATE_CACHE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed) {
        currentTournamentState = sanitizeTournamentState(parsed);
      }
    }
  } catch (e) {
    console.warn('Failed to load tournament cache', e);
  }
  return currentTournamentState;
}

export function saveCachedTournamentState(state: TournamentState): void {
  try {
    localStorage.setItem(STORAGE_KEY_TOURNAMENT_STATE_CACHE, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save tournament cache', e);
  }
}

/**
 * Notify all subscribed React listeners of state updates
 */
function notifyListeners(): void {
  const cloned = sanitizeTournamentState(currentTournamentState);
  currentTournamentState = cloned;
  saveCachedTournamentState(cloned);
  stateChangeListeners.forEach((listener) => {
    try {
      listener(cloned);
    } catch (e) {
      console.warn('Listener error in tournament sync', e);
    }
  });
}

/**
 * Fetch authoritative tournament state from Server API
 */
export async function fetchAuthoritativeTournamentState(
  tournamentId: string = 'FD_CUP_001'
): Promise<TournamentState> {
  try {
    const res = await fetch(`/api/tournament/status?id=${tournamentId}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.state) {
        currentTournamentState = sanitizeTournamentState({
          ...data.state,
          currentServerTimeMs: data.serverTimeMs || Date.now(),
        });
        notifyListeners();
        return currentTournamentState;
      }
    }
  } catch (e) {
    // Graceful fallback to Supabase table or local state
    console.warn('Server API status fetch failed, checking Supabase...', e);
  }

  // Supabase fallback query only if server API was unreachable
  try {
    const { data: entriesData, error } = await supabase
      .from('tournament_entries')
      .select('*')
      .eq('tournament_id', tournamentId);

    if (!error && entriesData && entriesData.length > 0) {
      const entries: TournamentEntry[] = entriesData.map((d: any) => ({
        tournamentId: d.tournament_id,
        userId: d.user_id,
        displayName: d.display_name,
        entryStatus: d.entry_status || 'ENTERED',
        enteredAt: new Date(d.entered_at).getTime(),
        teamSnapshot: d.team_snapshot,
        tacticsSnapshot: d.tactics_snapshot,
        defensiveSquadSnapshot: d.defensive_squad_snapshot,
        teamOvr: d.team_snapshot?.players?.length
          ? Math.round(
              d.team_snapshot.players.reduce((s: number, p: any) => s + p.rating, 0) /
                d.team_snapshot.players.length
            )
          : 85,
      }));

      currentTournamentState.entries = entries;
      currentTournamentState.definition.entryCount = entries.length;
    }
  } catch (e) {
    console.warn('Supabase fallback tournament check notice:', e);
  }

  // Supabase leaderboard table query for TOURNAMENT_ENTRY records
  try {
    const { data: lbEntries, error: lbErr } = await supabase
      .from('leaderboard')
      .select('id, created_at, player_name, score')
      .like('player_name', 'TOURNAMENT_ENTRY:%')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!lbErr && lbEntries && lbEntries.length > 0) {
      const entriesMap = new Map<string, TournamentEntry>();
      // Keep existing entries first
      currentTournamentState.entries.forEach((e) => entriesMap.set(e.userId, e));

      lbEntries.forEach((row: any) => {
        try {
          const raw = row.player_name.replace(/^TOURNAMENT_ENTRY:/, '');
          const entryObj = sanitizeTournamentEntry(JSON.parse(raw));
          if (entryObj && entryObj.userId) {
            entriesMap.set(entryObj.userId, entryObj);
          }
        } catch {}
      });

      currentTournamentState.entries = Array.from(entriesMap.values());
      currentTournamentState.definition.entryCount = currentTournamentState.entries.length;
    }
  } catch (e) {
    console.warn('Supabase leaderboard tournament entry query notice:', e);
  }

  // Re-evaluate status based on current time
  const evaluatedStatus = determineTournamentStatus(
    currentTournamentState.currentServerTimeMs || Date.now(),
    currentTournamentState.definition
  );

  // If status is still default and we evaluated something valid, update it
  if (currentTournamentState.definition.status === 'REGISTRATION' && evaluatedStatus !== 'REGISTRATION') {
    currentTournamentState.definition.status = evaluatedStatus;
  }

  notifyListeners();
  return currentTournamentState;
}

/**
 * Initialize Realtime Broadcast Channel & Polling Fallback
 */
export function initTournamentRealtime(
  onUpdate: (state: TournamentState) => void
): () => void {
  stateChangeListeners.add(onUpdate);

  // Initial load
  loadCachedTournamentState();
  onUpdate(currentTournamentState);
  fetchAuthoritativeTournamentState();

  // Setup Supabase Realtime Broadcast Channel
  if (!tournamentChannel) {
    try {
      tournamentChannel = supabase.channel(TOURNAMENT_CHANNEL_NAME);
      tournamentChannel
        .on('broadcast', { event: 'TOURNAMENT_STATE_UPDATE' }, ({ payload }: any) => {
          if (payload && payload.state) {
            currentTournamentState = {
              ...payload.state,
              currentServerTimeMs: payload.serverTimeMs || Date.now(),
            };
            notifyListeners();
          }
        })
        .on('broadcast', { event: 'TOURNAMENT_ENTRY_UPDATE' }, ({ payload }: any) => {
          if (payload && payload.entry) {
            const idx = currentTournamentState.entries.findIndex((e) => e.userId === payload.entry.userId);
            if (idx >= 0) {
              const updated = [...currentTournamentState.entries];
              updated[idx] = payload.entry;
              currentTournamentState.entries = updated;
            } else {
              currentTournamentState.entries = [...currentTournamentState.entries, payload.entry];
            }
            currentTournamentState.definition.entryCount = currentTournamentState.entries.length;
            notifyListeners();
            // Also confirm from server authority
            fetchAuthoritativeTournamentState();
          }
        })
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            // Connected to broadcast channel
          }
        });
    } catch (e) {
      console.warn('Failed to connect to tournament realtime broadcast', e);
    }
  }

  // Fast Periodic Polling Fallback (Every 3.5 seconds during active modal)
  if (!pollingInterval) {
    pollingInterval = setInterval(() => {
      fetchAuthoritativeTournamentState();
    }, 3500);
  }

  return () => {
    stateChangeListeners.delete(onUpdate);
    if (stateChangeListeners.size === 0) {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      if (tournamentChannel) {
        supabase.removeChannel(tournamentChannel);
        tournamentChannel = null;
      }
    }
  };
}

/**
 * Check if the user has already entered the tournament
 */
export function isUserEntered(userId: string): boolean {
  return currentTournamentState.entries.some((e) => e.userId === userId);
}

/**
 * Submit Official Tournament Entry
 * - Requires 11 players
 * - Saves snapshot of squad, tactics, defensive squad
 * - Stores to server & Supabase
 * - Broadcasts update to all connected clients
 */
export async function enterOfficialTournament(params: {
  userId: string;
  displayName: string;
  teamSnapshot: UserTeam;
  tacticsSnapshot: TeamTactics;
  defensiveSquadSnapshot?: UserTeam;
  tournamentId?: string;
}): Promise<{ success: boolean; error?: string; entry?: TournamentEntry }> {
  const {
    userId,
    displayName,
    teamSnapshot,
    tacticsSnapshot,
    defensiveSquadSnapshot,
    tournamentId = 'FD_CUP_001',
  } = params;

  // 1. Validate team count
  if (!teamSnapshot || !teamSnapshot.players || teamSnapshot.players.length < 11) {
    return {
      success: false,
      error: '公式大会に参加するには11人の選手を揃えてください',
    };
  }

  // 2. Validate phase
  const status = currentTournamentState.definition.status;
  if (status !== 'REGISTRATION' && status !== 'DRAFT') {
    return {
      success: false,
      error: 'エントリー受付期間外のため、エントリーできません。',
    };
  }

  const existingIdx = currentTournamentState.entries.findIndex((e) => e.userId === userId);
  const existingEntry = existingIdx >= 0 ? currentTournamentState.entries[existingIdx] : null;

  const players = Array.isArray(teamSnapshot?.players) ? teamSnapshot.players.filter(Boolean) : [];
  const teamOvr = players.length > 0
    ? Math.round(players.reduce((sum, p) => sum + (typeof p?.rating === 'number' ? p.rating : 85), 0) / players.length)
    : 85;

  const newEntry: TournamentEntry = {
    tournamentId,
    userId,
    displayName: displayName || existingEntry?.displayName || 'Manager',
    entryStatus: 'ENTERED',
    enteredAt: existingEntry?.enteredAt || Date.now(),
    teamSnapshot,
    tacticsSnapshot: {
      attackTactic: tacticsSnapshot?.attackTactic || 'POSSESSION',
      defenseTactic: tacticsSnapshot?.defenseTactic || 'MID_BLOCK',
      attackDirection: tacticsSnapshot?.attackDirection || 'BALANCED',
      pressIntensity: tacticsSnapshot?.pressIntensity || 'BALANCED',
    },
    defensiveSquadSnapshot,
    teamOvr,
    tacticsModifiedCount: existingEntry?.tacticsModifiedCount || 0,
  };

  // Optimistic local state update (upsert)
  if (existingIdx >= 0) {
    const updated = [...currentTournamentState.entries];
    updated[existingIdx] = newEntry;
    currentTournamentState.entries = updated;
  } else {
    currentTournamentState.entries = [...currentTournamentState.entries, newEntry];
  }
  currentTournamentState.definition.entryCount = currentTournamentState.entries.length;
  notifyListeners();

  // Broadcast to Realtime channel
  try {
    if (tournamentChannel) {
      tournamentChannel.send({
        type: 'broadcast',
        event: 'TOURNAMENT_ENTRY_UPDATE',
        payload: { entry: newEntry },
      });
    }
  } catch (e) {
    console.warn('Realtime entry broadcast failed', e);
  }

  // Save to Server API (Authoritative sync)
  try {
    const res = await fetch('/api/tournament/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournamentId,
        userId,
        displayName: newEntry.displayName,
        teamSnapshot,
        tacticsSnapshot,
        defensiveSquadSnapshot,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.entry) {
        // Confirm with server response
        fetchAuthoritativeTournamentState(tournamentId);
      }
    } else {
      const err = await res.json();
      console.warn('Server API entry warning:', err);
    }
  } catch (e) {
    console.warn('Server API entry network error', e);
  }

  // Save to Supabase DB table
  try {
    await supabase.from('tournament_entries').upsert(
      {
        tournament_id: tournamentId,
        user_id: userId,
        display_name: newEntry.displayName,
        entry_status: 'ENTERED',
        entered_at: new Date().toISOString(),
        team_snapshot: teamSnapshot,
        tactics_snapshot: tacticsSnapshot,
        defensive_squad_snapshot: defensiveSquadSnapshot || null,
      },
      { onConflict: 'tournament_id,user_id' }
    );
  } catch (e) {
    console.warn('Supabase DB tournament entry insert warning', e);
  }

  // Save to Supabase leaderboard table (Online single-store fallback)
  try {
    await supabase.from('leaderboard').insert({
      player_name: 'TOURNAMENT_ENTRY:' + JSON.stringify(newEntry),
      score: newEntry.teamOvr || 85,
    });
  } catch (e) {
    console.warn('Supabase leaderboard tournament entry insert note:', e);
  }

  return { success: true, entry: newEntry };
}

/**
 * Update Tournament-Specific Tactics
 * - Allowed anytime before next match starts
 * - Locked during match execution
 */
export async function updateTournamentTacticsOnline(
  userId: string,
  tactics: TeamTactics,
  tournamentId: string = 'FD_CUP_001'
): Promise<{ success: boolean; error?: string }> {
  // Check if current user is in a match right now
  const activeMatch = currentTournamentState.matches.find(
    (m) =>
      m.status === 'PLAYING' && (m.homeUserId === userId || m.awayUserId === userId)
  );

  if (activeMatch) {
    return {
      success: false,
      error: '試合進行中は戦術を変更できません。試合終了後にお試しください。',
    };
  }

  saveTournamentTactics(tactics);

  // Update in-memory entry
  const entryIdx = currentTournamentState.entries.findIndex((e) => e.userId === userId);
  if (entryIdx >= 0) {
    currentTournamentState.entries[entryIdx].tacticsSnapshot = tactics;
    currentTournamentState.entries[entryIdx].tacticsModifiedCount =
      (currentTournamentState.entries[entryIdx].tacticsModifiedCount || 0) + 1;
    notifyListeners();
  }

  // Update server
  try {
    await fetch('/api/tournament/tactics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournamentId, userId, tactics }),
    });
  } catch (e) {
    console.warn('Failed to update tournament tactics on server', e);
  }

  // Update Supabase
  try {
    await supabase
      .from('tournament_entries')
      .update({ tactics_snapshot: tactics })
      .match({ tournament_id: tournamentId, user_id: userId });
  } catch (e) {
    console.warn('Failed to update tournament tactics on Supabase', e);
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEV & TEST TOOLS (Requirements 35 & 36)
// Allows testing the complete tournament lifecycle without corrupting real user squads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Test: Populate Test Participants (with realistic squads & tactics)
 */
export async function testPopulateParticipants(
  count: number = 8,
  currentUserProfile?: { userId: string; username: string; team: UserTeam | null; tactics: TeamTactics }
): Promise<TournamentState> {
  try {
    const res = await fetch('/api/tournament/test/generate-participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, currentUserProfile }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.state) {
        currentTournamentState = sanitizeTournamentState(data.state);
        notifyListeners();
        return currentTournamentState;
      }
    }
  } catch (e) {
    console.warn('Server test populate failed, executing locally', e);
  }

  return currentTournamentState;
}

/**
 * Test: Advance Tournament Stage
 * REGISTRATION -> LOCKED -> GROUP_STAGE / ROUND_ROBIN -> KNOCKOUT -> FINISHED -> REWARDING -> COMPLETED
 */
export async function testAdvanceTournamentStage(): Promise<TournamentState> {
  try {
    const res = await fetch('/api/tournament/test/advance-stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.state) {
        currentTournamentState = sanitizeTournamentState(data.state);
        notifyListeners();
        return currentTournamentState;
      }
    }
  } catch (e) {
    console.warn('Server test advance failed', e);
  }

  return currentTournamentState;
}

/**
 * Test: Reset Tournament back to Registration
 */
export async function testResetTournament(): Promise<TournamentState> {
  try {
    const res = await fetch('/api/tournament/test/reset', {
      method: 'POST',
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.state) {
        currentTournamentState = sanitizeTournamentState(data.state);
        notifyListeners();
        return currentTournamentState;
      }
    }
  } catch (e) {
    console.warn('Server test reset failed', e);
  }

  return currentTournamentState;
}
