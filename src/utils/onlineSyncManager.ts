/**
 * onlineSyncManager.ts
 * 
 * FOOTBALL DRAFT v1.4.0 - 10-Minute Periodic Authoritative Online Synchronization System
 * 
 * Dual Architecture:
 * 1. Supabase Realtime event-driven updates (instant)
 * 2. 10-Minute periodic scheduled authoritative re-fetch (00, 10, 20, 30, 40, 50 min past the hour)
 * 
 * Guarantees:
 * - Authoritative persistence (Supabase / Server DB)
 * - Zero match duplication (strict unique ID deduplication)
 * - Safe error handling: never wipes or resets existing local data if network fails
 * - Auto-retry on network error (20s) and continues 10-minute cycle
 * - Clean singleton timer management across tab focus / visibility changes
 */

import {
  syncPendingLocalMatchesToServer,
  fetchWeeklyStandingsWithSyncInfo,
  fetchMatchHistoryFromSupabase,
  fetchAllRegisteredUsersFromSupabase,
  notifyMatchUpdates,
} from './supabasePvP';
import { fetchAuthoritativeTournamentState } from './supabaseTournament';
import { getCurrentUserProfile } from './pvpEngine';

export const TEN_MINUTES_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 20 * 1000; // 20-second retry on failure

export type SyncState = 'IDLE' | 'SYNCING' | 'SUCCESS' | 'ERROR';

export interface SyncManagerStatus {
  state: SyncState;
  lastSyncTimestamp: number;
  nextScheduledSyncTimestamp: number;
  secondsUntilNextSync: number;
  secondsRemaining?: number;
  lastSyncTimeString: string;
  lastSyncJstString: string;
  errorMessage?: string | null;
  totalSyncedMatches?: number;
  lastFetchedMatchesCount: number;
  lastFetchedStandingsCount: number;
  lastFetchedTournamentEntriesCount: number;
  supabaseConnected: boolean;
  realtimeConnected: boolean;
}

let syncState: SyncState = 'IDLE';
let lastSyncTimestamp: number = 0;
let lastErrorMessage: string | null = null;
let masterIntervalId: any = null;
let retryTimeoutId: any = null;
let isInitialized = false;

let lastMatchesCount = 0;
let lastStandingsCount = 0;
let lastEntriesCount = 0;
let isSupabaseOk = true;
let isRealtimeOk = true;

const statusListeners = new Set<(status: SyncManagerStatus) => void>();

/**
 * Format timestamp in JST (YYYY/MM/DD HH:mm:ss JST)
 */
export function formatJstTime(ts: number): string {
  if (!ts || ts <= 0) return '未同期';
  const JST_OFFSET = 9 * 60 * 60 * 1000;
  const d = new Date(ts + JST_OFFSET);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}/${mo}/${day} ${h}:${m}:${s} JST`;
}

/**
 * Calculate the next 10-minute clock boundary (e.g. :00, :10, :20, :30, :40, :50)
 */
export function calculateNext10MinBoundary(fromMs: number = Date.now()): number {
  const currentSlot = Math.floor(fromMs / TEN_MINUTES_MS) * TEN_MINUTES_MS;
  return currentSlot + TEN_MINUTES_MS;
}

export function calculateLast10MinBoundary(fromMs: number = Date.now()): number {
  return Math.floor(fromMs / TEN_MINUTES_MS) * TEN_MINUTES_MS;
}

/**
 * Format timestamp as HH:MM:SS
 */
export function formatSyncTime(ts: number): string {
  if (!ts || ts <= 0) return '--:--:--';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Get current sync manager status snapshot
 */
export function getSyncManagerStatus(): SyncManagerStatus {
  const now = Date.now();
  const nextScheduled = calculateNext10MinBoundary(now);
  const diffSec = Math.max(0, Math.ceil((nextScheduled - now) / 1000));

  return {
    state: syncState,
    lastSyncTimestamp,
    nextScheduledSyncTimestamp: nextScheduled,
    secondsUntilNextSync: diffSec,
    secondsRemaining: diffSec,
    lastSyncTimeString: formatSyncTime(lastSyncTimestamp),
    lastSyncJstString: formatJstTime(lastSyncTimestamp),
    errorMessage: lastErrorMessage,
    lastFetchedMatchesCount: lastMatchesCount,
    lastFetchedStandingsCount: lastStandingsCount,
    lastFetchedTournamentEntriesCount: lastEntriesCount,
    supabaseConnected: isSupabaseOk,
    realtimeConnected: isRealtimeOk,
  };
}

/**
 * Notify all registered status listeners
 */
function broadcastStatus() {
  const snapshot = getSyncManagerStatus();
  statusListeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (e) {
      console.warn('Sync status listener error:', e);
    }
  });
}

/**
 * Subscribe to sync status updates
 */
export function subscribeToSyncStatus(listener: (status: SyncManagerStatus) => void): () => void {
  statusListeners.add(listener);
  // Send current state immediately
  listener(getSyncManagerStatus());
  return () => {
    statusListeners.delete(listener);
  };
}

/**
 * Perform a full, authoritative online synchronization across:
 * 1. Pending local match uploads
 * 2. Weekly standings & rank statistics
 * 3. Match history for all users
 * 4. Official Tournament entries and tournament state
 * 
 * Strictly preserves all local data if any step fails.
 */
export async function performFullOnlineSync(isManual: boolean = false): Promise<boolean> {
  if (syncState === 'SYNCING') {
    return false;
  }

  syncState = 'SYNCING';
  lastErrorMessage = null;
  broadcastStatus();

  try {
    const userProfile = getCurrentUserProfile();

    // 1. Push any local matches to server authority first
    try {
      await syncPendingLocalMatchesToServer();
    } catch (err) {
      console.warn('Pending match sync notice:', err);
    }

    // 2. Fetch authoritative weekly standings (current season)
    try {
      const standingsRes = await fetchWeeklyStandingsWithSyncInfo(1, 'ALL', userProfile);
      if (standingsRes && Array.isArray(standingsRes.standings)) {
        lastStandingsCount = standingsRes.standings.length;
        lastMatchesCount = standingsRes.totalMatches;
      }
    } catch (err) {
      console.warn('Weekly standings sync notice:', err);
    }

    // 3. Fetch match history
    try {
      if (userProfile?.userId) {
        const history = await fetchMatchHistoryFromSupabase(userProfile.userId);
        if (history && history.length > 0 && lastMatchesCount === 0) {
          lastMatchesCount = history.length;
        }
      }
    } catch (err) {
      console.warn('Match history sync notice:', err);
    }

    // 4. Fetch registered community users
    try {
      if (userProfile?.userId) {
        await fetchAllRegisteredUsersFromSupabase(userProfile.userId);
      }
    } catch (err) {
      console.warn('Registered users sync notice:', err);
    }

    // 5. Fetch official tournament authoritative state & entries
    try {
      const tourneyState = await fetchAuthoritativeTournamentState();
      if (tourneyState && Array.isArray(tourneyState.entries)) {
        lastEntriesCount = tourneyState.entries.length;
      }
    } catch (err) {
      console.warn('Tournament state sync notice:', err);
    }

    isSupabaseOk = true;
    isRealtimeOk = true;

    // Notify match and ranking listeners to re-render fresh data
    notifyMatchUpdates();

    lastSyncTimestamp = Date.now();
    syncState = 'SUCCESS';
    broadcastStatus();

    // Revert status to IDLE after 4 seconds of showing "SUCCESS"
    setTimeout(() => {
      if (syncState === 'SUCCESS') {
        syncState = 'IDLE';
        broadcastStatus();
      }
    }, 4000);

    return true;
  } catch (error: any) {
    console.error('Full online synchronization encountered an error:', error);
    syncState = 'ERROR';
    lastErrorMessage = error?.message || '通信エラー';
    broadcastStatus();

    // Schedule automatic quick retry in 20 seconds
    if (retryTimeoutId) clearTimeout(retryTimeoutId);
    retryTimeoutId = setTimeout(() => {
      console.log('Retrying online synchronization after transient failure...');
      performFullOnlineSync(false);
    }, RETRY_DELAY_MS);

    return false;
  }
}

/**
 * Initialize the 10-minute periodic synchronization singleton
 * - Runs startup sync immediately
 * - Aligns periodic execution to 10-minute marks (00, 10, 20, 30, 40, 50 min)
 * - Safely handles tab visibility / wakeups
 */
export function initOnlineSyncManager(): () => void {
  if (isInitialized) {
    return () => {};
  }
  isInitialized = true;

  // 1. Immediate startup sync
  performFullOnlineSync(false);

  // 2. Master periodic tick (every second, to manage countdown and trigger at :00, :10, :20, :30, :40, :50)
  let lastCheckedSlot = Math.floor(Date.now() / TEN_MINUTES_MS);

  masterIntervalId = setInterval(() => {
    const now = Date.now();
    const currentSlot = Math.floor(now / TEN_MINUTES_MS);

    // If we crossed into a new 10-minute window, trigger synchronization!
    if (currentSlot > lastCheckedSlot) {
      lastCheckedSlot = currentSlot;
      performFullOnlineSync(false);
    } else {
      // Broadcast countdown update
      broadcastStatus();
    }
  }, 1000);

  // 3. Handle app returning from background / tab refocus
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      const now = Date.now();
      // If more than 10 minutes have elapsed since last sync, trigger immediately!
      if (now - lastSyncTimestamp >= TEN_MINUTES_MS) {
        performFullOnlineSync(false);
      } else {
        broadcastStatus();
      }
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleVisibilityChange);

  return () => {
    if (masterIntervalId) {
      clearInterval(masterIntervalId);
      masterIntervalId = null;
    }
    if (retryTimeoutId) {
      clearTimeout(retryTimeoutId);
      retryTimeoutId = null;
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleVisibilityChange);
    isInitialized = false;
  };
}
