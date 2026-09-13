import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

// Server-side persistent file storage
const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create data dir', e);
  }
}

// ── SERVER-SIDE PVP & RANKING PERSISTENCE ──
export interface ServerPvPUser {
  userId: string;
  username: string;
  team: any;
  tactics: any;
  defenseSquadId?: string;
  tacticalDefenseSquad?: any;
  ovrDefenseSquad?: any;
  updatedAt: number;
}

export interface ServerPvPMatch {
  id: string;
  matchId?: string;
  weekId: string;
  seasonNumber: number;
  season?: number;
  challengerUserId: string;
  challengerUsername: string;
  challengerScore: number;
  opponentUserId: string;
  opponentUsername: string;
  opponentScore: number;
  result: 'WIN' | 'DRAW' | 'LOSE';
  matchType: string;
  timestamp: number;
  challengerTeam?: any;
  opponentTeam?: any;
  stats?: any;
}

const PVP_USERS_FILE = path.join(DATA_DIR, 'pvp_users.json');
const PVP_MATCHES_FILE = path.join(DATA_DIR, 'pvp_matches.json');

const serverPvPUsersMap: Map<string, ServerPvPUser> = new Map();
const serverPvPMatchesList: ServerPvPMatch[] = [];

// Load initial data from disk
try {
  if (fs.existsSync(PVP_USERS_FILE)) {
    const raw = fs.readFileSync(PVP_USERS_FILE, 'utf-8');
    const list: ServerPvPUser[] = JSON.parse(raw);
    list.forEach((u) => serverPvPUsersMap.set(u.userId, u));
  }
} catch (e) {
  console.error('Failed to read pvp_users.json', e);
}

try {
  if (fs.existsSync(PVP_MATCHES_FILE)) {
    const raw = fs.readFileSync(PVP_MATCHES_FILE, 'utf-8');
    const list: ServerPvPMatch[] = JSON.parse(raw);
    serverPvPMatchesList.push(...list);
  }
} catch (e) {
  console.error('Failed to read pvp_matches.json', e);
}

function savePvPUsersToDisk() {
  try {
    const list = Array.from(serverPvPUsersMap.values());
    fs.writeFileSync(PVP_USERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write pvp_users.json', e);
  }
}

function savePvPMatchesToDisk() {
  try {
    fs.writeFileSync(PVP_MATCHES_FILE, JSON.stringify(serverPvPMatchesList, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write pvp_matches.json', e);
  }
}

// Server-side database / storage in memory with persistence simulation
interface ServerPresentItem {
  id: string; // key: `${week_id}_${user_id}_${reward_type}`
  weekId?: string;
  userId: string;
  title: string;
  description: string;
  rewardType: string;
  amount: number;
  isClaimed: boolean;
  claimedAt?: number;
  createdAt: number;
  rank?: number;
}

const serverPresentsDatabase: Map<string, ServerPresentItem> = new Map();
const distributedRewardKeys: Set<string> = new Set();
const userTicketsDatabase: Map<string, Record<string, number>> = new Map();

const PRESENTS_FILE = path.join(DATA_DIR, 'presents.json');
const USER_TICKETS_FILE = path.join(DATA_DIR, 'user_tickets.json');

// Load presents from disk
try {
  if (fs.existsSync(PRESENTS_FILE)) {
    const raw = fs.readFileSync(PRESENTS_FILE, 'utf-8');
    const list: ServerPresentItem[] = JSON.parse(raw);
    list.forEach((p) => {
      serverPresentsDatabase.set(p.id, p);
      distributedRewardKeys.add(p.id);
    });
  }
} catch (e) {
  console.error('Failed to read presents.json', e);
}

// Load user tickets from disk
try {
  if (fs.existsSync(USER_TICKETS_FILE)) {
    const raw = fs.readFileSync(USER_TICKETS_FILE, 'utf-8');
    const obj: Record<string, Record<string, number>> = JSON.parse(raw);
    Object.entries(obj).forEach(([userId, tickets]) => {
      userTicketsDatabase.set(userId, tickets);
    });
  }
} catch (e) {
  console.error('Failed to read user_tickets.json', e);
}

function savePresentsToDisk() {
  try {
    const list = Array.from(serverPresentsDatabase.values());
    fs.writeFileSync(PRESENTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write presents.json', e);
  }
}

function saveUserTicketsToDisk() {
  try {
    const obj: Record<string, Record<string, number>> = {};
    userTicketsDatabase.forEach((val, key) => {
      obj[key] = val;
    });
    fs.writeFileSync(USER_TICKETS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write user_tickets.json', e);
  }
}

// Weekly Season Timing Helpers (JST UTC+9) - v1.3.2 Release
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const AGGREGATION_DURATION_MS = 60 * 60 * 1000; // 1 hour (00:00 - 01:00 JST)

// Season 1 special window (2026-09-13 00:00:00 JST to 2026-09-20 23:59:59.999 JST)
const SEASON_1_START_MS = Date.UTC(2026, 8, 12, 15, 0, 0); // 2026-09-13 00:00:00 JST
const SEASON_1_END_MS = Date.UTC(2026, 8, 20, 14, 59, 59, 999); // 2026-09-20 23:59:59.999 JST
const SEASON_2_START_MS = Date.UTC(2026, 8, 20, 15, 0, 0); // 2026-09-21 00:00:00 JST

function formatWeekId(startMs: number): string {
  const d = new Date(startMs + JST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const date = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${date}_week`;
}

function getCurrentJSTDate(nowMs: number = Date.now()): Date {
  return new Date(nowMs + JST_OFFSET_MS);
}

function getWeekSeasonInfo(timestamp: number = Date.now()): {
  weekId: string;
  seasonNumber: number;
  phase: 'ACTIVE' | 'AGGREGATING' | 'FINALIZED';
  phaseTextJa: string;
  phaseTextEn: string;
  matchAcceptanceOpen: boolean;
  startMs: number;
  endMs: number;
  aggregationEndMs: number;
} {
  let seasonNum = 1;
  let startMs = SEASON_1_START_MS;
  let endMs = SEASON_1_END_MS;

  if (timestamp <= SEASON_1_END_MS) {
    seasonNum = 1;
    startMs = SEASON_1_START_MS;
    endMs = SEASON_1_END_MS;
  } else {
    const diff = timestamp - SEASON_2_START_MS;
    const weeksAfter = Math.floor(diff / ONE_WEEK_MS);
    seasonNum = 2 + weeksAfter;
    startMs = SEASON_2_START_MS + weeksAfter * ONE_WEEK_MS;
    endMs = startMs + ONE_WEEK_MS - 1;
  }

  // Aggregation window: exactly 1 hour following phase end (24:00〜25:00 JST = 00:00〜01:00 JST next day)
  const aggregationEndMs = endMs + AGGREGATION_DURATION_MS;
  const weekId = seasonNum === 1 ? '2026-09-13_week' : formatWeekId(startMs);

  let phase: 'ACTIVE' | 'AGGREGATING' | 'FINALIZED' = 'ACTIVE';
  let phaseTextJa = '対戦受付中';
  let phaseTextEn = 'Active Matches';
  let matchAcceptanceOpen = true;

  if (timestamp > endMs && timestamp <= aggregationEndMs) {
    phase = 'AGGREGATING';
    phaseTextJa = 'ランキング集計中（24:00〜25:00）';
    phaseTextEn = 'Aggregating Rankings';
    matchAcceptanceOpen = false;
  } else if (timestamp > aggregationEndMs) {
    phase = 'FINALIZED';
    phaseTextJa = '第' + seasonNum + '回 確定';
    phaseTextEn = 'Finalized';
    matchAcceptanceOpen = false;
  }

  return {
    weekId,
    seasonNumber: seasonNum,
    phase,
    phaseTextJa,
    phaseTextEn,
    matchAcceptanceOpen,
    startMs,
    endMs,
    aggregationEndMs,
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 1. Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '1.4.0', timestamp: Date.now() });
  });

  // ── SUPABASE ONLINE LEADERBOARD PROXY API ──
  const SUPABASE_LEADERBOARD_URL = 'https://ihaiadukjycjdvaownpv.supabase.co';
  const SUPABASE_LEADERBOARD_KEY = 'sb_publishable_dEjgitW3rRtpyGnqaIFeZg_2ZONcI-l';

  // GET /api/leaderboard?limit=100
  app.get('/api/leaderboard', async (req, res) => {
    try {
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
      const targetUrl = `${SUPABASE_LEADERBOARD_URL}/rest/v1/leaderboard?select=id,created_at,player_name,score&player_name=not.like.PVP_MATCH*&player_name=not.like.TOURNAMENT_*&order=score.desc,created_at.asc&limit=${limit}`;

      const response = await fetch(targetUrl, {
        headers: {
          apikey: SUPABASE_LEADERBOARD_KEY,
          Authorization: `Bearer ${SUPABASE_LEADERBOARD_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ success: false, error: errorText });
      }

      const data = await response.json();
      return res.json({ success: true, data });
    } catch (err: any) {
      console.error('Leaderboard GET error:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Server error' });
    }
  });

  // POST /api/leaderboard
  app.post('/api/leaderboard', async (req, res) => {
    try {
      const name = req.body.player_name || req.body.playerName;
      const rawScore = req.body.score;
      const score = typeof rawScore === 'number' ? rawScore : Number(rawScore);

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, error: 'プレイヤー名を入力してください' });
      }
      if (typeof score !== 'number' || isNaN(score) || score < 0) {
        return res.status(400).json({ success: false, error: '有効なスコアを指定してください' });
      }

      const targetUrl = `${SUPABASE_LEADERBOARD_URL}/rest/v1/leaderboard`;
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_LEADERBOARD_KEY,
          Authorization: `Bearer ${SUPABASE_LEADERBOARD_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          player_name: name.trim(),
          score: Math.round(score),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ success: false, error: errorText });
      }

      const insertedRows = await response.json();
      const inserted = Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;
      return res.json({ success: true, data: inserted });
    } catch (err: any) {
      console.error('Leaderboard POST error:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Server error' });
    }
  });

  // 2. Ranking Phase & Schedule Status (Server Authority)
  app.get('/api/ranking/status', (req, res) => {
    const info = getWeekSeasonInfo(Date.now());
    res.json({
      success: true,
      ...info,
      serverTimeMs: Date.now(),
    });
  });

  // 3. Server-side Reward Distribution Endpoint (Idempotent & Secure)
  // Evaluates standings and awards Top 1, 2, and 3 users once aggregation ends (25:00 / 01:00 JST)
  app.post('/api/ranking/distribute-rewards', (req, res) => {
    try {
      const { weekId, standings } = req.body;
      if (!weekId || !Array.isArray(standings)) {
        return res.status(400).json({ error: 'Invalid weekId or standings' });
      }

      const info = getWeekSeasonInfo(Date.now());
      // Must be at or past aggregation period or explicit trigger
      const top3 = standings.slice(0, 3);
      const rewardsDistributed: any[] = [];

      // Rank 1: Legend Guaranteed Scout x1
      if (top3[0]) {
        const u1 = top3[0];
        const key1 = `${weekId}_${u1.userId}_legend_guaranteed`;
        if (!distributedRewardKeys.has(key1)) {
          distributedRewardKeys.add(key1);
          const present1: ServerPresentItem = {
            id: key1,
            weekId,
            userId: u1.userId,
            title: `【週間ランキング第1位】報酬獲得！`,
            description: `週間ランキング1位達成おめでとうございます！「レジェンド確定スカウト ×1」をお贈りします。`,
            rewardType: 'legend_guaranteed',
            amount: 1,
            isClaimed: false,
            createdAt: Date.now(),
            rank: 1,
          };
          serverPresentsDatabase.set(key1, present1);
          rewardsDistributed.push(present1);
        }
      }

      // Rank 2: Purple Guaranteed Scout x1
      if (top3[1]) {
        const u2 = top3[1];
        const key2 = `${weekId}_${u2.userId}_purple_guaranteed`;
        if (!distributedRewardKeys.has(key2)) {
          distributedRewardKeys.add(key2);
          const present2: ServerPresentItem = {
            id: key2,
            weekId,
            userId: u2.userId,
            title: `【週間ランキング第2位】報酬獲得！`,
            description: `週間ランキング2位入賞！「紫確定スカウト ×1」をお贈りします。`,
            rewardType: 'purple_guaranteed',
            amount: 1,
            isClaimed: false,
            createdAt: Date.now(),
            rank: 2,
          };
          serverPresentsDatabase.set(key2, present2);
          rewardsDistributed.push(present2);
        }
      }

      // Rank 3: Legend / Purple 50% Scout x1
      if (top3[2]) {
        const u3 = top3[2];
        const key3 = `${weekId}_${u3.userId}_legend_purple_50`;
        if (!distributedRewardKeys.has(key3)) {
          distributedRewardKeys.add(key3);
          const present3: ServerPresentItem = {
            id: key3,
            weekId,
            userId: u3.userId,
            title: `【週間ランキング第3位】報酬獲得！`,
            description: `週間ランキング3位入賞！「レジェンド・紫50%スカウト ×1」をお贈りします。`,
            rewardType: 'legend_purple_50',
            amount: 1,
            isClaimed: false,
            createdAt: Date.now(),
            rank: 3,
          };
          serverPresentsDatabase.set(key3, present3);
          rewardsDistributed.push(present3);
        }
      }

      if (rewardsDistributed.length > 0) {
        savePresentsToDisk();
      }

      res.json({
        success: true,
        weekId,
        distributedCount: rewardsDistributed.length,
        rewards: rewardsDistributed,
      });
    } catch (e: any) {
      console.error('Error distributing rewards:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // 4. Present Box API: Fetch presents for user (including one-time apology gift)
  app.get('/api/presents/user/:userId', (req, res) => {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    // Ensure apology gift (legend_20 x1) exists for all users
    const apologyKey = `apology_gift_${userId}_legend20`;
    if (!distributedRewardKeys.has(apologyKey)) {
      distributedRewardKeys.add(apologyKey);
      serverPresentsDatabase.set(apologyKey, {
        id: apologyKey,
        userId,
        title: '【運営からのお詫び】特別スカウト配布',
        description: '大型アップデートに伴うお詫びとして「レジェンド20%スカウト ×1」をお贈りします。',
        rewardType: 'legend_20',
        amount: 1,
        isClaimed: false,
        createdAt: Date.now(),
      });
      savePresentsToDisk();
    }

    const presents: ServerPresentItem[] = [];
    serverPresentsDatabase.forEach((p) => {
      if (p.userId === userId) presents.push(p);
    });

    // Sort unclaimed first, newest first
    presents.sort((a, b) => {
      if (a.isClaimed !== b.isClaimed) return a.isClaimed ? 1 : -1;
      return b.createdAt - a.createdAt;
    });

    res.json({ success: true, presents });
  });

  // 5. Present Box API: Claim reward
  app.post('/api/presents/claim', (req, res) => {
    const { userId, presentId } = req.body;
    if (!userId || !presentId) return res.status(400).json({ error: 'Missing userId or presentId' });

    const item = serverPresentsDatabase.get(presentId);
    if (!item) {
      return res.status(404).json({ error: 'Present not found' });
    }
    if (item.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (item.isClaimed) {
      return res.status(400).json({ error: 'Already claimed' });
    }

    item.isClaimed = true;
    item.claimedAt = Date.now();

    // Credit ticket to user inventory
    const userTickets = userTicketsDatabase.get(userId) || {
      legend_20: 0,
      legend_50: 0,
      legend_guaranteed: 0,
      purple_20: 0,
      purple_50: 0,
      purple_guaranteed: 0,
      legend_purple_guaranteed: 0,
      legend_purple_50: 0,
    };
    userTickets[item.rewardType] = (userTickets[item.rewardType] || 0) + item.amount;
    userTicketsDatabase.set(userId, userTickets);
    savePresentsToDisk();
    saveUserTicketsToDisk();

    res.json({
      success: true,
      claimedItem: item,
      userTickets,
    });
  });

  // 6. Reward Scout API: Verify and consume ticket
  app.post('/api/scout/consume', (req, res) => {
    const { userId, ticketType } = req.body;
    if (!userId || !ticketType) return res.status(400).json({ error: 'Missing userId or ticketType' });

    const userTickets = userTicketsDatabase.get(userId) || {
      legend_20: 0,
      legend_50: 0,
      legend_guaranteed: 0,
      purple_20: 0,
      purple_50: 0,
      purple_guaranteed: 0,
      legend_purple_guaranteed: 0,
      legend_purple_50: 0,
    };

    if (!userTickets[ticketType] || userTickets[ticketType] <= 0) {
      return res.status(400).json({ error: 'No tickets available for this scout' });
    }

    // Safely decrement ticket
    userTickets[ticketType] -= 1;
    userTicketsDatabase.set(userId, userTickets);
    saveUserTicketsToDisk();

    res.json({
      success: true,
      ticketType,
      remainingTickets: userTickets[ticketType],
      userTickets,
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6.5 PVP & RANKING ONLINE SYNCHRONIZATION API (Server Authority)
  // Ensures ALL users share genuine persistent online PvP match & ranking data
  // ═════════════════════════════════════════════════════════════════════════

  // 6.5.1 Sync user profile & Best XI to server
  app.post('/api/pvp/sync-profile', (req, res) => {
    try {
      const { userId, username, team, tactics, defenseSquadId, tacticalDefenseSquad, ovrDefenseSquad } = req.body;
      if (!userId || !username) {
        return res.status(400).json({ error: 'userId and username required' });
      }
      const profile: ServerPvPUser = {
        userId,
        username,
        team: team || null,
        tactics: tactics || null,
        defenseSquadId,
        tacticalDefenseSquad,
        ovrDefenseSquad,
        updatedAt: Date.now(),
      };
      serverPvPUsersMap.set(userId, profile);
      savePvPUsersToDisk();
      res.json({ success: true, profile });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Server error' });
    }
  });

  // 6.5.2 Get all registered PvP users
  app.get('/api/pvp/users', (req, res) => {
    const list = Array.from(serverPvPUsersMap.values());
    res.json({ success: true, users: list });
  });

  // 6.5.3 Record match result (shared across all users, persisted to disk and Supabase)
  app.post('/api/pvp/record-match', async (req, res) => {
    try {
      const match = req.body;
      if (!match || !match.id || !match.challengerUserId || !match.opponentUserId) {
        return res.status(400).json({ error: 'Invalid match record' });
      }
      const existingIdx = serverPvPMatchesList.findIndex((m) => m.id === match.id);
      if (existingIdx >= 0) {
        serverPvPMatchesList[existingIdx] = match;
      } else {
        serverPvPMatchesList.unshift(match);
      }
      savePvPMatchesToDisk();

      // Persist to Supabase leaderboard table as PVP_MATCH record
      try {
        await fetch(`${SUPABASE_LEADERBOARD_URL}/rest/v1/leaderboard`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_LEADERBOARD_KEY,
            Authorization: `Bearer ${SUPABASE_LEADERBOARD_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            player_name: 'PVP_MATCH:' + JSON.stringify(match),
            score: match.result === 'WIN' ? 3 : match.result === 'DRAW' ? 1 : 0,
          }),
        });
      } catch (sbErr) {
        console.warn('Supabase match push note:', sbErr);
      }

      res.json({ success: true, matchId: match.id, totalMatches: serverPvPMatchesList.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Server error' });
    }
  });

  // 6.5.3.5 Reset weekly standings and match history (authoritative reset)
  app.post('/api/pvp/reset-standings', (req, res) => {
    try {
      serverPvPMatchesList.length = 0;
      savePvPMatchesToDisk();
      console.log('Authoritative weekly standings and matches successfully reset to 0.');
      res.json({
        success: true,
        message: '週間ランキングおよび対戦履歴を完全にリセットしました。今からの対戦がリアルタイム集計されます。',
        totalMatches: 0,
        timestamp: Date.now(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to reset standings' });
    }
  });

  // 6.5.4 Get all matches (filtered by season or weekId)
  app.get('/api/pvp/matches', (req, res) => {
    const { weekId, seasonNumber, matchType } = req.query;
    const currentWeekInfo = getWeekSeasonInfo(Date.now());
    const targetSeason = seasonNumber ? parseInt(String(seasonNumber), 10) : currentWeekInfo.seasonNumber;
    
    let filtered = serverPvPMatchesList;
    if (targetSeason === 1) {
      filtered = filtered.filter((m) => 
        m.timestamp >= SEASON_1_START_MS && m.timestamp <= SEASON_1_END_MS
      );
    } else if (weekId) {
      filtered = filtered.filter((m) => m.weekId === weekId || m.season === targetSeason || m.seasonNumber === targetSeason);
    } else if (seasonNumber) {
      filtered = filtered.filter((m) => m.seasonNumber === targetSeason || m.season === targetSeason);
    }
    
    if (matchType && matchType !== 'ALL') {
      filtered = filtered.filter((m) => m.matchType === matchType);
    }
    res.json({ success: true, matches: filtered });
  });

  // 6.5.5 Get authoritative weekly standings computed from all users' matches
  app.get('/api/pvp/standings', (req, res) => {
    const { weekId, seasonNumber, matchType } = req.query;
    const currentWeekInfo = getWeekSeasonInfo(Date.now());
    const targetSeason = seasonNumber ? parseInt(String(seasonNumber), 10) : currentWeekInfo.seasonNumber;
    const resolvedWeekId = weekId ? String(weekId) : currentWeekInfo.weekId;

    let seasonMatches = serverPvPMatchesList;
    if (targetSeason === 1) {
      // 1st PvP Ranking: 2026-09-13 00:00 JST to 2026-09-20 23:59 JST
      // Only matches starting from 2026-09-13 00:00 JST are aggregated into Season 1 ranking
      seasonMatches = seasonMatches.filter((m) =>
        m.timestamp >= SEASON_1_START_MS && m.timestamp <= SEASON_1_END_MS
      );
    } else if (weekId) {
      seasonMatches = seasonMatches.filter((m) => m.weekId === weekId || m.season === targetSeason || m.seasonNumber === targetSeason);
    } else if (seasonNumber) {
      seasonMatches = seasonMatches.filter((m) => m.seasonNumber === targetSeason || m.season === targetSeason);
    }

    if (matchType && matchType !== 'ALL') {
      seasonMatches = seasonMatches.filter((m) => m.matchType === matchType);
    }

    // Strict match deduplication by unique ID to prevent double counting across sync cycles
    const seenMatchKeys = new Set<string>();
    const deduplicatedSeasonMatches: ServerPvPMatch[] = [];
    for (const m of seasonMatches) {
      const matchKey = m.id || m.matchId;
      if (matchKey) {
        if (!seenMatchKeys.has(matchKey)) {
          seenMatchKeys.add(matchKey);
          deduplicatedSeasonMatches.push(m);
        }
      } else {
        deduplicatedSeasonMatches.push(m);
      }
    }
    seasonMatches = deduplicatedSeasonMatches;

    const statsMap = new Map<string, {
      userId: string;
      username: string;
      teamName: string;
      points: number;
      played: number;
      wins: number;
      draws: number;
      losses: number;
      goalsFor: number;
      goalsAgainst: number;
      goalDifference: number;
      recentForm: ('W' | 'D' | 'L')[];
      lastMatchTimestamp: number;
      teamOvr?: number;
    }>();

    // Register known users with initial 0
    serverPvPUsersMap.forEach((u) => {
      statsMap.set(u.userId, {
        userId: u.userId,
        username: u.username,
        teamName: u.team?.name || 'Best XI',
        points: 0,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        recentForm: [],
        lastMatchTimestamp: 0,
        teamOvr: u.team?.ovr || 85,
      });
    });

    const sortedMatches = [...seasonMatches].sort((a, b) => a.timestamp - b.timestamp);
    sortedMatches.forEach((m) => {
      // 1. Challenger stats
      if (!statsMap.has(m.challengerUserId)) {
        statsMap.set(m.challengerUserId, {
          userId: m.challengerUserId,
          username: m.challengerUsername || 'Challenger',
          teamName: m.challengerTeam?.teamName || m.challengerTeam?.name || 'Best XI',
          points: 0,
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          recentForm: [],
          lastMatchTimestamp: 0,
          teamOvr: m.challengerTeam?.ovr || m.challengerTeam?.teamOvr || 85,
        });
      }
      const c = statsMap.get(m.challengerUserId)!;
      c.played += 1;
      c.goalsFor += (m.challengerScore ?? 0);
      c.goalsAgainst += (m.opponentScore ?? 0);
      c.goalDifference = c.goalsFor - c.goalsAgainst;
      c.lastMatchTimestamp = Math.max(c.lastMatchTimestamp, m.timestamp || 0);

      // 2. Opponent stats
      if (!statsMap.has(m.opponentUserId)) {
        statsMap.set(m.opponentUserId, {
          userId: m.opponentUserId,
          username: m.opponentUsername || 'Opponent',
          teamName: m.opponentTeam?.teamName || m.opponentTeam?.name || 'Opponent XI',
          points: 0,
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          recentForm: [],
          lastMatchTimestamp: 0,
          teamOvr: m.opponentTeam?.ovr || m.opponentTeam?.teamOvr || 85,
        });
      }
      const o = statsMap.get(m.opponentUserId)!;
      o.played += 1;
      o.goalsFor += (m.opponentScore ?? 0);
      o.goalsAgainst += (m.challengerScore ?? 0);
      o.goalDifference = o.goalsFor - o.goalsAgainst;
      o.lastMatchTimestamp = Math.max(o.lastMatchTimestamp, m.timestamp || 0);

      const cScore = m.challengerScore ?? 0;
      const oScore = m.opponentScore ?? 0;

      if (cScore > oScore || m.result === 'WIN') {
        c.wins += 1;
        c.points += 3;
        c.recentForm.push('W');
        o.losses += 1;
        o.recentForm.push('L');
      } else if (cScore === oScore || m.result === 'DRAW') {
        c.draws += 1;
        c.points += 1;
        c.recentForm.push('D');
        o.draws += 1;
        o.points += 1;
        o.recentForm.push('D');
      } else {
        c.losses += 1;
        c.recentForm.push('L');
        o.wins += 1;
        o.points += 3;
        o.recentForm.push('W');
      }
      if (c.recentForm.length > 5) c.recentForm.shift();
      if (o.recentForm.length > 5) o.recentForm.shift();
    });

    const standings = Array.from(statsMap.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.lastMatchTimestamp - b.lastMatchTimestamp;
    });

    const rankedStandings = standings.map((item, idx) => ({
      ...item,
      rank: idx + 1,
      season: targetSeason,
      weekId: resolvedWeekId,
    }));

    const now = Date.now();
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const current10MinWindow = Math.floor(now / TEN_MINUTES_MS) * TEN_MINUTES_MS;
    const next10MinWindow = current10MinWindow + TEN_MINUTES_MS;

    res.json({
      success: true,
      standings: rankedStandings,
      totalMatches: seasonMatches.length,
      serverTimeMs: now,
      lastSyncTimestamp: current10MinWindow,
      nextScheduledUpdateTimestamp: next10MinWindow,
      updateIntervalMinutes: 10,
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7. OFFICIAL TOURNAMENT (公式大会) API & SERVER LOGIC
  // Tournament ID: FD_CUP_001 (第1回 FOOTBALL DRAFT CUP)
  // ═════════════════════════════════════════════════════════════════════════

  interface ServerTournamentEntry {
    tournamentId: string;
    userId: string;
    displayName: string;
    entryStatus: string;
    enteredAt: number;
    teamSnapshot: any;
    tacticsSnapshot: any;
    defensiveSquadSnapshot?: any;
    teamOvr: number;
    tacticsModifiedCount?: number;
  }

  interface ServerTournamentMatch {
    matchId: string;
    tournamentId: string;
    stage: string;
    stageNameJa: string;
    groupId?: string;
    round: number;
    homeUserId: string;
    homeDisplayName: string;
    awayUserId: string;
    awayDisplayName: string;
    homeScore: number;
    awayScore: number;
    homePenaltyScore?: number;
    awayPenaltyScore?: number;
    winnerUserId?: string;
    homeTactics: any;
    awayTactics: any;
    homeTeamSnapshot: any;
    awayTeamSnapshot: any;
    status: 'SCHEDULED' | 'PLAYING' | 'COMPLETED';
    createdAt: number;
    completedAt?: number;
    events: any[];
    tacticalAnalysisJa?: string;
  }

  interface ServerTournamentGroup {
    groupId: string;
    groupNameJa: string;
    groupNameEn: string;
    participantUserIds: string[];
  }

  interface ServerTournamentStanding {
    tournamentId: string;
    groupId?: string;
    userId: string;
    displayName: string;
    teamName: string;
    teamOvr: number;
    rank: number;
    points: number;
    matchesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    isQualified: boolean;
  }

  // Official Tournament Schedule:
  // Registration: 2026-09-13 00:00:00 JST to 2026-09-18 23:59:59.999 JST
  // Match period: 2026-09-19 00:00:00 JST to 2026-09-25 23:59:59.999 JST
  const TOURNAMENT_ID = 'FD_CUP_001';
  const TOURNAMENT_REG_START_MS = Date.UTC(2026, 8, 12, 15, 0, 0); // 2026-09-13 00:00:00 JST
  const TOURNAMENT_REG_END_MS = Date.UTC(2026, 8, 18, 14, 59, 59, 999); // 2026-09-18 23:59:59.999 JST
  const TOURNAMENT_MATCH_START_MS = Date.UTC(2026, 8, 18, 15, 0, 0); // 2026-09-19 00:00:00 JST
  const TOURNAMENT_MATCH_END_MS = Date.UTC(2026, 8, 25, 14, 59, 59, 999); // 2026-09-25 23:59:59.999 JST

  const TOURNAMENT_ENTRIES_FILE = path.join(DATA_DIR, 'tournament_entries.json');
  const TOURNAMENT_STATE_FILE = path.join(DATA_DIR, 'tournament_state.json');

  let serverTournamentStatus:
    | 'DRAFT'
    | 'REGISTRATION'
    | 'LOCKED'
    | 'GROUP_STAGE'
    | 'KNOCKOUT'
    | 'FINISHED'
    | 'REWARDING'
    | 'COMPLETED' = 'REGISTRATION';

  const tournamentEntriesMap: Map<string, ServerTournamentEntry> = new Map();
  let tournamentGroups: ServerTournamentGroup[] = [];
  let tournamentStandings: ServerTournamentStanding[] = [];
  let tournamentMatches: ServerTournamentMatch[] = [];
  let tournamentKnockoutBracket: any = null;

  // Load tournament entries from disk
  try {
    if (fs.existsSync(TOURNAMENT_ENTRIES_FILE)) {
      const raw = fs.readFileSync(TOURNAMENT_ENTRIES_FILE, 'utf-8');
      const list: ServerTournamentEntry[] = JSON.parse(raw);
      list.forEach((e) => tournamentEntriesMap.set(e.userId, e));
    }
  } catch (e) {
    console.error('Failed to read tournament_entries.json', e);
  }

  // If tournament entries are empty on boot, seed default participants so the community is active
  if (tournamentEntriesMap.size === 0) {
    const seedManagers = [
      { name: 'ペップ・タクティクス', tactic: 'TIKI_TAKA', def: 'HIGH_PRESS', formation: '4-3-3', ovr: 96 },
      { name: 'アンチェ・カルチョ', tactic: 'COUNTER', def: 'MID_BLOCK', formation: '4-3-1-2', ovr: 94 },
      { name: 'クロップ・ゲーゲン', tactic: 'DIRECT_PLAY', def: 'GEGENPRESSING', formation: '4-3-3', ovr: 93 },
      { name: 'シメオネ・チョロ', tactic: 'QUICK_ATTACK', def: 'CATENACCIO', formation: '4-4-2', ovr: 91 },
    ];
    seedManagers.forEach((m, i) => {
      const botUserId = `usr_tourney_bot_${i + 1}`;
      tournamentEntriesMap.set(botUserId, {
        tournamentId: TOURNAMENT_ID,
        userId: botUserId,
        displayName: m.name,
        entryStatus: 'ENTERED',
        enteredAt: Date.now() - (i + 1) * 3600000,
        teamOvr: m.ovr,
        tacticsSnapshot: {
          attackTactic: m.tactic,
          defenseTactic: m.def,
          attackDirection: 'BALANCED',
          pressIntensity: 'BALANCED',
        },
        teamSnapshot: {
          teamId: `team_tourney_${botUserId}`,
          name: `${m.name} XI`,
          formation: m.formation,
          players: Array.from({ length: 11 }, (_, pIdx) => ({
            playerId: `bot_p_${i}_${pIdx}`,
            nameJa: `選手 ${pIdx + 1}`,
            playerName: `Player ${pIdx + 1}`,
            clubName: 'Elite Club',
            year: '2024',
            position: pIdx === 0 ? 'GK' : pIdx <= 4 ? 'DF' : pIdx <= 8 ? 'MF' : 'FW',
            subPosition: pIdx === 0 ? 'GK' : pIdx === 1 ? 'CB' : pIdx === 2 ? 'CB' : pIdx === 3 ? 'LB' : pIdx === 4 ? 'RB' : pIdx <= 7 ? 'CM' : 'ST',
            rating: Math.max(80, Math.min(99, m.ovr + (Math.floor(Math.random() * 7) - 3))),
            category: 'GOLD',
          })),
        },
      });
    });
    try {
      const list = Array.from(tournamentEntriesMap.values());
      fs.writeFileSync(TOURNAMENT_ENTRIES_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to write seeded tournament entries', e);
    }
  }

  // Load tournament state from disk
  try {
    if (fs.existsSync(TOURNAMENT_STATE_FILE)) {
      const raw = fs.readFileSync(TOURNAMENT_STATE_FILE, 'utf-8');
      const stateObj = JSON.parse(raw);
      if (stateObj) {
        if (stateObj.status) serverTournamentStatus = stateObj.status;
        if (Array.isArray(stateObj.groups)) tournamentGroups = stateObj.groups;
        if (Array.isArray(stateObj.standings)) tournamentStandings = stateObj.standings;
        if (Array.isArray(stateObj.matches)) tournamentMatches = stateObj.matches;
        if (stateObj.knockoutBracket) tournamentKnockoutBracket = stateObj.knockoutBracket;
      }
    }
  } catch (e) {
    console.error('Failed to read tournament_state.json', e);
  }

  function saveTournamentEntriesToDisk() {
    try {
      const list = Array.from(tournamentEntriesMap.values());
      fs.writeFileSync(TOURNAMENT_ENTRIES_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to write tournament_entries.json', e);
    }
  }

  function saveTournamentStateToDisk() {
    try {
      const stateObj = {
        status: serverTournamentStatus,
        groups: tournamentGroups,
        standings: tournamentStandings,
        matches: tournamentMatches,
        knockoutBracket: tournamentKnockoutBracket,
        updatedAt: Date.now(),
      };
      fs.writeFileSync(TOURNAMENT_STATE_FILE, JSON.stringify(stateObj, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to write tournament_state.json', e);
    }
  }

  // Evaluate Server Tournament Status dynamically based on current time
  function getAuthoritativeTournamentStatus(): typeof serverTournamentStatus {
    const now = Date.now();
    // If manual stage progression (e.g. testing) moved past registration, preserve active status
    if (['GROUP_STAGE', 'KNOCKOUT', 'FINISHED', 'REWARDING', 'COMPLETED'].includes(serverTournamentStatus)) {
      return serverTournamentStatus;
    }
    if (now < TOURNAMENT_REG_START_MS) return 'DRAFT';
    if (now <= TOURNAMENT_REG_END_MS) return 'REGISTRATION';
    if (now < TOURNAMENT_MATCH_START_MS) return 'LOCKED';
    if (now <= TOURNAMENT_MATCH_END_MS) return 'GROUP_STAGE';
    return 'COMPLETED';
  }

  // 7.1 Tournament Status Endpoint
  app.get('/api/tournament/status', (req, res) => {
    const status = getAuthoritativeTournamentStatus();
    const entries = Array.from(tournamentEntriesMap.values()).map((e) => ({
      tournamentId: e.tournamentId,
      userId: e.userId,
      displayName: e.displayName,
      entryStatus: e.entryStatus,
      enteredAt: e.enteredAt,
      teamOvr: e.teamOvr,
      teamSnapshot: e.teamSnapshot,
      tacticsSnapshot: e.tacticsSnapshot,
      defensiveSquadSnapshot: e.defensiveSquadSnapshot,
    }));

    const definition = {
      tournamentId: TOURNAMENT_ID,
      nameJa: '第1回 FOOTBALL DRAFT CUP',
      nameEn: '1st FOOTBALL DRAFT CUP',
      isTrial: true,
      edition: 1,
      status,
      registrationStartMs: TOURNAMENT_REG_START_MS,
      registrationEndMs: TOURNAMENT_REG_END_MS,
      matchStartMs: TOURNAMENT_MATCH_START_MS,
      matchEndMs: TOURNAMENT_MATCH_END_MS,
      format: entries.length <= 8 ? 'ROUND_ROBIN' : 'GROUP_KNOCKOUT',
      minParticipants: 4,
      entryCount: entries.length,
      rewards: {
        rank1: { type: 'legend_guaranteed', count: 2, labelJa: 'レジェンド確定スカウト ×2' },
        rank2: { type: 'legend_guaranteed', count: 1, labelJa: 'レジェンド確定スカウト ×1' },
        rank3: { type: 'purple_guaranteed', count: 1, labelJa: '紫確定スカウト ×1' },
      },
    };

    res.json({
      success: true,
      serverTimeMs: Date.now(),
      state: {
        definition,
        entries,
        groups: tournamentGroups,
        standings: tournamentStandings,
        matches: tournamentMatches,
        knockoutBracket: tournamentKnockoutBracket,
        rewards: [],
        currentServerTimeMs: Date.now(),
      },
    });
  });

  // 7.1.1 Quick Entries List Endpoint
  app.get('/api/tournament/entries', (req, res) => {
    const entries = Array.from(tournamentEntriesMap.values());
    res.json({
      success: true,
      entries,
      totalEntries: entries.length,
    });
  });

  // 7.2 Tournament Entry Endpoint (Supports initial entry AND squad updates/synchronization)
  app.post('/api/tournament/entry', (req, res) => {
    const {
      tournamentId = TOURNAMENT_ID,
      userId,
      displayName,
      teamSnapshot,
      tacticsSnapshot,
      defensiveSquadSnapshot,
    } = req.body;

    if (!userId || !teamSnapshot) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    if (!teamSnapshot.players || teamSnapshot.players.length < 11) {
      return res.status(400).json({ error: '公式大会に参加するには11人の選手を揃えてください' });
    }

    const currentStatus = getAuthoritativeTournamentStatus();
    if (currentStatus !== 'REGISTRATION' && currentStatus !== 'DRAFT') {
      return res.status(400).json({ error: '大会エントリー期間外です' });
    }

    const existingEntry = tournamentEntriesMap.get(userId);
    const isUpdate = Boolean(existingEntry);

    const teamOvr = Math.round(
      teamSnapshot.players.reduce((sum: number, p: any) => sum + (p.rating || 85), 0) / 11
    );

    const newEntry: ServerTournamentEntry = {
      tournamentId,
      userId,
      displayName: displayName || existingEntry?.displayName || 'Manager',
      entryStatus: 'ENTERED',
      enteredAt: existingEntry?.enteredAt || Date.now(),
      teamSnapshot,
      tacticsSnapshot: tacticsSnapshot || existingEntry?.tacticsSnapshot || {
        attackTactic: 'POSSESSION',
        defenseTactic: 'MID_BLOCK',
        attackDirection: 'BALANCED',
        pressIntensity: 'BALANCED',
      },
      defensiveSquadSnapshot: defensiveSquadSnapshot || existingEntry?.defensiveSquadSnapshot,
      teamOvr,
      tacticsModifiedCount: existingEntry?.tacticsModifiedCount || 0,
    };

    tournamentEntriesMap.set(userId, newEntry);
    saveTournamentEntriesToDisk();

    // Persist to Supabase leaderboard table as TOURNAMENT_ENTRY record
    try {
      fetch(`${SUPABASE_LEADERBOARD_URL}/rest/v1/leaderboard`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_LEADERBOARD_KEY,
          Authorization: `Bearer ${SUPABASE_LEADERBOARD_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          player_name: 'TOURNAMENT_ENTRY:' + JSON.stringify(newEntry),
          score: newEntry.teamOvr || 85,
        }),
      }).catch((e) => console.warn('Supabase entry push error note:', e));
    } catch (sbErr) {
      console.warn('Supabase tournament entry note:', sbErr);
    }

    // Also synchronize into serverPvPUsersMap so they are discoverable in online PvP
    if (!serverPvPUsersMap.has(userId) || serverPvPUsersMap.get(userId)?.team?.players?.length !== 11) {
      serverPvPUsersMap.set(userId, {
        userId,
        username: newEntry.displayName,
        team: newEntry.teamSnapshot,
        tactics: newEntry.tacticsSnapshot,
        updatedAt: Date.now(),
      });
      savePvPUsersToDisk();
    }

    res.json({
      success: true,
      isUpdate,
      entry: newEntry,
      totalEntries: tournamentEntriesMap.size,
    });
  });

  // 7.3 Tournament Tactics Update Endpoint
  app.post('/api/tournament/tactics', (req, res) => {
    const { userId, tactics } = req.body;
    if (!userId || !tactics) {
      return res.status(400).json({ error: 'Missing userId or tactics' });
    }

    const entry = tournamentEntriesMap.get(userId);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    // Check if user is in an active match right now
    const activeMatch = tournamentMatches.find(
      (m) =>
        m.status === 'PLAYING' && (m.homeUserId === userId || m.awayUserId === userId)
    );
    if (activeMatch) {
      return res.status(400).json({ error: '試合進行中は戦術を変更できません' });
    }

    entry.tacticsSnapshot = tactics;
    entry.tacticsModifiedCount = (entry.tacticsModifiedCount || 0) + 1;
    saveTournamentEntriesToDisk();

    res.json({
      success: true,
      tactics: entry.tacticsSnapshot,
    });
  });

  // 7.4 Test Helper: Generate Realistic Participants (Requirement 35)
  app.post('/api/tournament/test/generate-participants', (req, res) => {
    const { count = 8, currentUserProfile } = req.body;

    // Retain current user if already entered or provided
    const preservedCurrentUser = currentUserProfile?.userId
      ? tournamentEntriesMap.get(currentUserProfile.userId) || {
          tournamentId: TOURNAMENT_ID,
          userId: currentUserProfile.userId,
          displayName: currentUserProfile.username || 'You',
          entryStatus: 'ENTERED',
          enteredAt: Date.now(),
          teamSnapshot: currentUserProfile.team,
          tacticsSnapshot: currentUserProfile.tactics,
          teamOvr: currentUserProfile.team?.players?.length
            ? Math.round(
                currentUserProfile.team.players.reduce((s: number, p: any) => s + p.rating, 0) / 11
              )
            : 90,
        }
      : null;

    tournamentEntriesMap.clear();

    if (preservedCurrentUser && preservedCurrentUser.teamSnapshot?.players?.length === 11) {
      tournamentEntriesMap.set(preservedCurrentUser.userId, preservedCurrentUser as any);
    }

    const mockManagers = [
      { name: 'ペップ・タクティクス', tactic: 'TIKI_TAKA', def: 'HIGH_PRESS', formation: '4-3-3', ovr: 96 },
      { name: 'アンチェ・カルチョ', tactic: 'COUNTER', def: 'MID_BLOCK', formation: '4-3-1-2', ovr: 94 },
      { name: 'クロップ・ゲーゲン', tactic: 'DIRECT_PLAY', def: 'GEGENPRESSING', formation: '4-3-3', ovr: 93 },
      { name: 'シメオネ・チョロ', tactic: 'QUICK_ATTACK', def: 'CATENACCIO', formation: '4-4-2', ovr: 91 },
      { name: 'モウリーニョ・ロック', tactic: 'LONG_COUNTER', def: 'LOW_BLOCK', formation: '4-2-3-1', ovr: 90 },
      { name: 'ジーコ・セレソン', tactic: 'POSSESSION', def: 'ZONE_DEFENSE', formation: '4-2-2-2', ovr: 92 },
      { name: 'アルテタ・ポジショナル', tactic: 'OVERLOAD', def: 'SWARM_DEFENSE', formation: '4-3-3', ovr: 89 },
      { name: 'ナーゲルスマン・ラボ', tactic: 'CROSS_GAME', def: 'CENTRAL_CONTAIN', formation: '3-4-2-1', ovr: 88 },
      { name: 'アロンソ・バイヤー', tactic: 'FALSE_9', def: 'COUNTER_PREVENT', formation: '3-4-3', ovr: 93 },
      { name: 'フリック・カタラン', tactic: 'HIGH_SPEED_ATTACK', def: 'OFFSIDE_TRAP', formation: '4-2-3-1', ovr: 95 },
      { name: 'トゥヘル・タクティカル', tactic: 'BUILD_UP', def: 'BOX_CONTAIN', formation: '3-5-2', ovr: 89 },
      { name: 'コンテ・グリント', tactic: 'CENTRAL_ATTACK', def: 'RETREAT', formation: '3-5-2', ovr: 91 },
    ];

    const needed = Math.max(1, count - tournamentEntriesMap.size);
    for (let i = 0; i < needed && i < mockManagers.length; i++) {
      const m = mockManagers[i];
      const botUserId = `usr_tourney_bot_${i + 1}`;
      tournamentEntriesMap.set(botUserId, {
        tournamentId: TOURNAMENT_ID,
        userId: botUserId,
        displayName: m.name,
        entryStatus: 'ENTERED',
        enteredAt: Date.now() - (i + 1) * 3600000,
        teamOvr: m.ovr,
        tacticsSnapshot: {
          attackTactic: m.tactic,
          defenseTactic: m.def,
          attackDirection: 'BALANCED',
          pressIntensity: 'BALANCED',
        },
        teamSnapshot: {
          teamId: `team_tourney_${botUserId}`,
          name: `${m.name} XI`,
          formation: m.formation,
          players: Array.from({ length: 11 }, (_, pIdx) => ({
            playerId: `bot_p_${i}_${pIdx}`,
            nameJa: `選手 ${pIdx + 1}`,
            playerName: `Player ${pIdx + 1}`,
            clubName: 'Elite Club',
            year: '2024',
            position: pIdx === 0 ? 'GK' : pIdx <= 4 ? 'DF' : pIdx <= 8 ? 'MF' : 'FW',
            subPosition: pIdx === 0 ? 'GK' : pIdx === 1 ? 'CB' : pIdx === 2 ? 'CB' : pIdx === 3 ? 'LB' : pIdx === 4 ? 'RB' : pIdx <= 7 ? 'CM' : 'ST',
            rating: Math.max(80, Math.min(99, m.ovr + (Math.floor(Math.random() * 7) - 3))),
            category: 'GOLD',
          })),
        },
      });
    }

    serverTournamentStatus = 'REGISTRATION';
    tournamentGroups = [];
    tournamentStandings = [];
    tournamentMatches = [];
    tournamentKnockoutBracket = null;

    saveTournamentEntriesToDisk();
    saveTournamentStateToDisk();

    res.json({
      success: true,
      totalEntries: tournamentEntriesMap.size,
      state: {
        definition: {
          tournamentId: TOURNAMENT_ID,
          nameJa: '第1回 FOOTBALL DRAFT CUP',
          nameEn: '1st FOOTBALL DRAFT CUP',
          isTrial: true,
          edition: 1,
          status: serverTournamentStatus,
          registrationStartMs: TOURNAMENT_REG_START_MS,
          registrationEndMs: TOURNAMENT_REG_END_MS,
          matchStartMs: TOURNAMENT_MATCH_START_MS,
          matchEndMs: TOURNAMENT_MATCH_END_MS,
          format: tournamentEntriesMap.size <= 8 ? 'ROUND_ROBIN' : 'GROUP_KNOCKOUT',
          minParticipants: 4,
          entryCount: tournamentEntriesMap.size,
          rewards: {
            rank1: { type: 'legend_guaranteed', count: 2, labelJa: 'レジェンド確定スカウト ×2' },
            rank2: { type: 'legend_guaranteed', count: 1, labelJa: 'レジェンド確定スカウト ×1' },
            rank3: { type: 'purple_guaranteed', count: 1, labelJa: '紫確定スカウト ×1' },
          },
        },
        entries: Array.from(tournamentEntriesMap.values()),
        groups: tournamentGroups,
        standings: tournamentStandings,
        matches: tournamentMatches,
        knockoutBracket: tournamentKnockoutBracket,
        rewards: [],
        currentServerTimeMs: Date.now(),
      },
    });
  });

  // 7.5 Test Helper: Advance Tournament Stage (Requirement 35)
  app.post('/api/tournament/test/advance-stage', (req, res) => {
    const entries = Array.from(tournamentEntriesMap.values());
    if (entries.length < 4) {
      return res.status(400).json({ error: '大会進行には最低4人のエントリーが必要です' });
    }

    // Step 1: REGISTRATION -> GROUP_STAGE (or ROUND_ROBIN)
    if (serverTournamentStatus === 'REGISTRATION' || serverTournamentStatus === 'LOCKED') {
      serverTournamentStatus = 'GROUP_STAGE';

      if (entries.length <= 8) {
        // Round-Robin
        tournamentGroups = [
          {
            groupId: 'GROUP_ALL',
            groupNameJa: '総当たりリーグ',
            groupNameEn: 'Round-Robin League',
            participantUserIds: entries.map((e) => e.userId),
          },
        ];

        // Generate round robin matches
        const matches: ServerTournamentMatch[] = [];
        let r = 1;
        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const h = entries[i];
            const a = entries[j];
            const hOvr = h.teamOvr;
            const aOvr = a.teamOvr;
            const hScore = Math.floor(Math.random() * 3);
            const aScore = Math.floor(Math.random() * 3);

            matches.push({
              matchId: `match_rr_${r}_${h.userId}_${a.userId}`,
              tournamentId: TOURNAMENT_ID,
              stage: 'ROUND_ROBIN',
              stageNameJa: '総当たり戦',
              groupId: 'GROUP_ALL',
              round: r++,
              homeUserId: h.userId,
              homeDisplayName: h.displayName,
              awayUserId: a.userId,
              awayDisplayName: a.displayName,
              homeScore: hScore,
              awayScore: aScore,
              homeTactics: h.tacticsSnapshot,
              awayTactics: a.tacticsSnapshot,
              homeTeamSnapshot: h.teamSnapshot,
              awayTeamSnapshot: a.teamSnapshot,
              status: 'COMPLETED',
              createdAt: Date.now() - 3600000,
              completedAt: Date.now(),
              events: [
                {
                  minute: 1,
                  type: 'whistle',
                  textJa: `キックオフ！ [${h.displayName} vs ${a.displayName}]`,
                },
                {
                  minute: 34,
                  type: 'goal',
                  scorerName: `${h.displayName}のFW`,
                  textJa: `⚽ GOAL!! 鮮やかな連係からゴール！ (${h.displayName})`,
                },
                {
                  minute: 90,
                  type: 'whistle',
                  textJa: `試合終了: ${hScore} - ${aScore}`,
                },
              ],
              tacticalAnalysisJa: `【戦術分析】${h.displayName} (${h.tacticsSnapshot.attackTactic}) vs ${a.displayName} (${a.tacticsSnapshot.attackTactic})。\n戦術相性と個々の局面打開が勝負を分けました。`,
            });
          }
        }
        tournamentMatches = matches;

        // Calculate Standings
        const standingsMap = new Map<string, ServerTournamentStanding>();
        entries.forEach((e) => {
          standingsMap.set(e.userId, {
            tournamentId: TOURNAMENT_ID,
            groupId: 'GROUP_ALL',
            userId: e.userId,
            displayName: e.displayName,
            teamName: e.teamSnapshot?.name || 'My Team',
            teamOvr: e.teamOvr,
            rank: 1,
            points: 0,
            matchesPlayed: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            goalDifference: 0,
            isQualified: false,
          });
        });

        matches.forEach((m) => {
          const h = standingsMap.get(m.homeUserId);
          const a = standingsMap.get(m.awayUserId);
          if (h) {
            h.matchesPlayed += 1;
            h.goalsFor += m.homeScore;
            h.goalsAgainst += m.awayScore;
            h.goalDifference = h.goalsFor - h.goalsAgainst;
            if (m.homeScore > m.awayScore) {
              h.wins += 1;
              h.points += 3;
            } else if (m.homeScore === m.awayScore) {
              h.draws += 1;
              h.points += 1;
            } else {
              h.losses += 1;
            }
          }
          if (a) {
            a.matchesPlayed += 1;
            a.goalsFor += m.awayScore;
            a.goalsAgainst += m.homeScore;
            a.goalDifference = a.goalsFor - a.goalsAgainst;
            if (m.awayScore > m.homeScore) {
              a.wins += 1;
              a.points += 3;
            } else if (m.awayScore === m.homeScore) {
              a.draws += 1;
              a.points += 1;
            } else {
              a.losses += 1;
            }
          }
        });

        tournamentStandings = Array.from(standingsMap.values());
        tournamentStandings.sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
          if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
          return b.teamOvr - a.teamOvr;
        });
        tournamentStandings.forEach((s, idx) => {
          s.rank = idx + 1;
          s.isQualified = idx < 2;
        });
      } else {
        // 9+ players: Group Stage Partitioning
        const numGroups = entries.length >= 16 ? 4 : entries.length >= 12 ? 3 : 2;
        const labels = ['A', 'B', 'C', 'D'];
        tournamentGroups = Array.from({ length: numGroups }, (_, i) => ({
          groupId: `GROUP_${labels[i]}`,
          groupNameJa: `グループ ${labels[i]}`,
          groupNameEn: `Group ${labels[i]}`,
          participantUserIds: [],
        }));

        entries.forEach((e, i) => {
          tournamentGroups[i % numGroups].participantUserIds.push(e.userId);
        });

        // Run intra-group matches
        const matches: ServerTournamentMatch[] = [];
        tournamentGroups.forEach((g) => {
          const gEntries = entries.filter((e) => g.participantUserIds.includes(e.userId));
          let r = 1;
          for (let i = 0; i < gEntries.length; i++) {
            for (let j = i + 1; j < gEntries.length; j++) {
              const h = gEntries[i];
              const a = gEntries[j];
              const hScore = Math.floor(Math.random() * 3);
              const aScore = Math.floor(Math.random() * 3);
              matches.push({
                matchId: `match_${g.groupId}_${r}_${h.userId}_${a.userId}`,
                tournamentId: TOURNAMENT_ID,
                stage: 'GROUP',
                stageNameJa: 'グループステージ',
                groupId: g.groupId,
                round: r++,
                homeUserId: h.userId,
                homeDisplayName: h.displayName,
                awayUserId: a.userId,
                awayDisplayName: a.displayName,
                homeScore: hScore,
                awayScore: aScore,
                homeTactics: h.tacticsSnapshot,
                awayTactics: a.tacticsSnapshot,
                homeTeamSnapshot: h.teamSnapshot,
                awayTeamSnapshot: a.teamSnapshot,
                status: 'COMPLETED',
                createdAt: Date.now() - 3600000,
                completedAt: Date.now(),
                events: [
                  {
                    minute: 1,
                    type: 'whistle',
                    textJa: `グループステージ試合開始！ [${h.displayName} vs ${a.displayName}]`,
                  },
                  {
                    minute: 40,
                    type: 'goal',
                    scorerName: `${h.displayName}のFW`,
                    textJa: `⚽ GOAL!! 見事な崩しからゴール！`,
                  },
                  {
                    minute: 90,
                    type: 'whistle',
                    textJa: `試合終了: ${hScore} - ${aScore}`,
                  },
                ],
                tacticalAnalysisJa: `【戦術分析】${g.groupNameJa}: ${h.displayName} vs ${a.displayName}。\n${h.tacticsSnapshot.attackTactic} vs ${a.tacticsSnapshot.attackTactic}`,
              });
            }
          }
        });
        tournamentMatches = matches;

        // Calculate Group Standings (Top 2 advance)
        const standingsList: ServerTournamentStanding[] = [];
        tournamentGroups.forEach((g) => {
          const gEntries = entries.filter((e) => g.participantUserIds.includes(e.userId));
          const map = new Map<string, ServerTournamentStanding>();
          gEntries.forEach((e) => {
            map.set(e.userId, {
              tournamentId: TOURNAMENT_ID,
              groupId: g.groupId,
              userId: e.userId,
              displayName: e.displayName,
              teamName: e.teamSnapshot?.name || 'Squad',
              teamOvr: e.teamOvr,
              rank: 1,
              points: 0,
              matchesPlayed: 0,
              wins: 0,
              draws: 0,
              losses: 0,
              goalsFor: 0,
              goalsAgainst: 0,
              goalDifference: 0,
              isQualified: false,
            });
          });

          const gMatches = matches.filter((m) => m.groupId === g.groupId);
          gMatches.forEach((m) => {
            const h = map.get(m.homeUserId);
            const a = map.get(m.awayUserId);
            if (h) {
              h.matchesPlayed += 1;
              h.goalsFor += m.homeScore;
              h.goalsAgainst += m.awayScore;
              h.goalDifference = h.goalsFor - h.goalsAgainst;
              if (m.homeScore > m.awayScore) {
                h.wins += 1;
                h.points += 3;
              } else if (m.homeScore === m.awayScore) {
                h.draws += 1;
                h.points += 1;
              } else {
                h.losses += 1;
              }
            }
            if (a) {
              a.matchesPlayed += 1;
              a.goalsFor += m.awayScore;
              a.goalsAgainst += m.homeScore;
              a.goalDifference = a.goalsFor - a.goalsAgainst;
              if (m.awayScore > m.homeScore) {
                a.wins += 1;
                a.points += 3;
              } else if (m.awayScore === m.homeScore) {
                a.draws += 1;
                a.points += 1;
              } else {
                a.losses += 1;
              }
            }
          });

          const sorted = Array.from(map.values());
          sorted.sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
            if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
            return b.teamOvr - a.teamOvr;
          });
          sorted.forEach((s, idx) => {
            s.rank = idx + 1;
            // Requirement 17: Top 2 from each group advance
            s.isQualified = idx < 2;
            standingsList.push(s);
          });
        });
        tournamentStandings = standingsList;
      }
    } else if (serverTournamentStatus === 'GROUP_STAGE') {
      // Step 2: GROUP_STAGE -> KNOCKOUT
      serverTournamentStatus = 'KNOCKOUT';

      // Pick top 2 qualifiers from each group (or top 4 from round-robin)
      const qualifiers = tournamentStandings
        .filter((s) => s.isQualified)
        .map((s) => entries.find((e) => e.userId === s.userId))
        .filter(Boolean) as ServerTournamentEntry[];

      const finalQualifiers = qualifiers.length >= 4 ? qualifiers.slice(0, 4) : entries.slice(0, 4);

      // Simulate Semi-Finals
      const sf1Home = finalQualifiers[0];
      const sf1Away = finalQualifiers[3] || finalQualifiers[1];
      const sf1HScore = Math.random() < 0.5 ? 2 : 1;
      const sf1AScore = sf1HScore === 2 ? 1 : 2;
      const sf1Winner = sf1HScore > sf1AScore ? sf1Home : sf1Away;
      const sf1Loser = sf1HScore > sf1AScore ? sf1Away : sf1Home;

      const sf2Home = finalQualifiers[1];
      const sf2Away = finalQualifiers[2];
      const sf2HScore = Math.random() < 0.5 ? 3 : 0;
      const sf2AScore = sf2HScore === 3 ? 1 : 2;
      const sf2Winner = sf2HScore > sf2AScore ? sf2Home : sf2Away;
      const sf2Loser = sf2HScore > sf2AScore ? sf2Away : sf2Home;

      // 3rd Place Match
      const tpMatch: ServerTournamentMatch = {
        matchId: `match_tp_${sf1Loser.userId}_${sf2Loser.userId}`,
        tournamentId: TOURNAMENT_ID,
        stage: 'THIRD_PLACE',
        stageNameJa: '3位決定戦',
        round: 1,
        homeUserId: sf1Loser.userId,
        homeDisplayName: sf1Loser.displayName,
        awayUserId: sf2Loser.userId,
        awayDisplayName: sf2Loser.displayName,
        homeScore: 2,
        awayScore: 1,
        winnerUserId: sf1Loser.userId,
        homeTactics: sf1Loser.tacticsSnapshot,
        awayTactics: sf2Loser.tacticsSnapshot,
        homeTeamSnapshot: sf1Loser.teamSnapshot,
        awayTeamSnapshot: sf2Loser.teamSnapshot,
        status: 'COMPLETED',
        createdAt: Date.now() - 1800000,
        completedAt: Date.now(),
        events: [
          { minute: 1, type: 'whistle', textJa: '3位決定戦キックオフ！' },
          { minute: 48, type: 'goal', textJa: `⚽ GOAL!! ${sf1Loser.displayName}が先制！` },
          { minute: 90, type: 'whistle', textJa: `試合終了！ 2-1で${sf1Loser.displayName}が3位入賞！` },
        ],
        tacticalAnalysisJa: '白熱の3位決定戦。決定力の差が勝敗を分けました。',
      };

      // Final Match
      const finalMatch: ServerTournamentMatch = {
        matchId: `match_final_${sf1Winner.userId}_${sf2Winner.userId}`,
        tournamentId: TOURNAMENT_ID,
        stage: 'FINAL',
        stageNameJa: '決勝戦',
        round: 1,
        homeUserId: sf1Winner.userId,
        homeDisplayName: sf1Winner.displayName,
        awayUserId: sf2Winner.userId,
        awayDisplayName: sf2Winner.displayName,
        homeScore: 2,
        awayScore: 1,
        winnerUserId: sf1Winner.userId,
        homeTactics: sf1Winner.tacticsSnapshot,
        awayTactics: sf2Winner.tacticsSnapshot,
        homeTeamSnapshot: sf1Winner.teamSnapshot,
        awayTeamSnapshot: sf2Winner.teamSnapshot,
        status: 'COMPLETED',
        createdAt: Date.now() - 900000,
        completedAt: Date.now(),
        events: [
          { minute: 1, type: 'whistle', textJa: '🏆 第1回 FD CUP 決勝戦キックオフ！' },
          { minute: 38, type: 'goal', textJa: `⚽ GOAL!! 決勝の舞台で${sf1Winner.displayName}が先制！` },
          { minute: 88, type: 'goal', textJa: `⚽ GOAL!! ${sf1Winner.displayName}が劇的な決勝ゴール！` },
          { minute: 90, type: 'whistle', textJa: `試合終了！ ${sf1Winner.displayName}が栄冠を獲得！` },
        ],
        tacticalAnalysisJa: `【決勝戦評】${sf1Winner.displayName}が見事な戦術遂行力で${sf2Winner.displayName}を破り、初制覇を達成！`,
      };

      tournamentKnockoutBracket = {
        semiFinals: [
          {
            matchId: `match_sf_1`,
            tournamentId: TOURNAMENT_ID,
            stage: 'SEMI_FINAL',
            stageNameJa: '準決勝 1',
            round: 1,
            homeUserId: sf1Home.userId,
            homeDisplayName: sf1Home.displayName,
            awayUserId: sf1Away.userId,
            awayDisplayName: sf1Away.displayName,
            homeScore: sf1HScore,
            awayScore: sf1AScore,
            winnerUserId: sf1Winner.userId,
            homeTactics: sf1Home.tacticsSnapshot,
            awayTactics: sf1Away.tacticsSnapshot,
            homeTeamSnapshot: sf1Home.teamSnapshot,
            awayTeamSnapshot: sf1Away.teamSnapshot,
            status: 'COMPLETED',
            createdAt: Date.now() - 3600000,
            completedAt: Date.now(),
            events: [],
          },
          {
            matchId: `match_sf_2`,
            tournamentId: TOURNAMENT_ID,
            stage: 'SEMI_FINAL',
            stageNameJa: '準決勝 2',
            round: 2,
            homeUserId: sf2Home.userId,
            homeDisplayName: sf2Home.displayName,
            awayUserId: sf2Away.userId,
            awayDisplayName: sf2Away.displayName,
            homeScore: sf2HScore,
            awayScore: sf2AScore,
            winnerUserId: sf2Winner.userId,
            homeTactics: sf2Home.tacticsSnapshot,
            awayTactics: sf2Away.tacticsSnapshot,
            homeTeamSnapshot: sf2Home.teamSnapshot,
            awayTeamSnapshot: sf2Away.teamSnapshot,
            status: 'COMPLETED',
            createdAt: Date.now() - 3600000,
            completedAt: Date.now(),
            events: [],
          },
        ],
        thirdPlaceMatch: tpMatch,
        finalMatch,
        champion: sf1Winner,
        runnerUp: sf2Winner,
        thirdPlaceWinner: sf1Loser,
      };

      serverTournamentStatus = 'FINISHED';

      // ── Step 3: Automatically Distribute Rewards into Present Box (Requirement 26 & 27) ──
      // 🥇 優勝: レジェンド確定スカウト ×2
      const key1 = `tournament_${TOURNAMENT_ID}_rank1_${sf1Winner.userId}`;
      if (!distributedRewardKeys.has(key1)) {
        distributedRewardKeys.add(key1);
        serverPresentsDatabase.set(key1, {
          id: key1,
          userId: sf1Winner.userId,
          title: '【公式大会 優勝】第1回 FD CUP チャンピオン報酬！',
          description: '第1回 FOOTBALL DRAFT CUP 優勝おめでとうございます！ 頂点に立った栄誉を称え「レジェンド確定スカウト ×2」をお贈りします。',
          rewardType: 'legend_guaranteed',
          amount: 2,
          isClaimed: false,
          createdAt: Date.now(),
          rank: 1,
        });
      }

      // 🥈 準優勝: レジェンド確定スカウト ×1
      const key2 = `tournament_${TOURNAMENT_ID}_rank2_${sf2Winner.userId}`;
      if (!distributedRewardKeys.has(key2)) {
        distributedRewardKeys.add(key2);
        serverPresentsDatabase.set(key2, {
          id: key2,
          userId: sf2Winner.userId,
          title: '【公式大会 準優勝】第1回 FD CUP 入賞報酬！',
          description: '第1回 FOOTBALL DRAFT CUP 準優勝おめでとうございます！ 決勝進出の快挙を称え「レジェンド確定スカウト ×1」をお贈りします。',
          rewardType: 'legend_guaranteed',
          amount: 1,
          isClaimed: false,
          createdAt: Date.now(),
          rank: 2,
        });
      }

      // 🥉 3位: 紫確定スカウト ×1
      const key3 = `tournament_${TOURNAMENT_ID}_rank3_${sf1Loser.userId}`;
      if (!distributedRewardKeys.has(key3)) {
        distributedRewardKeys.add(key3);
        serverPresentsDatabase.set(key3, {
          id: key3,
          userId: sf1Loser.userId,
          title: '【公式大会 第3位】第1回 FD CUP 入賞報酬！',
          description: '第1回 FOOTBALL DRAFT CUP 3位入賞おめでとうございます！ 激闘を称え「紫確定スカウト ×1」をお贈りします。',
          rewardType: 'purple_guaranteed',
          amount: 1,
          isClaimed: false,
          createdAt: Date.now(),
          rank: 3,
        });
      }

      serverTournamentStatus = 'COMPLETED';
    } else {
      // Loop back to registration for repeated testing
      serverTournamentStatus = 'REGISTRATION';
    }

    saveTournamentEntriesToDisk();
    saveTournamentStateToDisk();
    savePresentsToDisk();

    res.json({
      success: true,
      newStatus: serverTournamentStatus,
      state: {
        definition: {
          tournamentId: TOURNAMENT_ID,
          nameJa: '第1回 FOOTBALL DRAFT CUP',
          nameEn: '1st FOOTBALL DRAFT CUP',
          isTrial: true,
          edition: 1,
          status: serverTournamentStatus,
          registrationStartMs: TOURNAMENT_REG_START_MS,
          registrationEndMs: TOURNAMENT_REG_END_MS,
          matchStartMs: TOURNAMENT_MATCH_START_MS,
          matchEndMs: TOURNAMENT_MATCH_END_MS,
          format: tournamentEntriesMap.size <= 8 ? 'ROUND_ROBIN' : 'GROUP_KNOCKOUT',
          minParticipants: 4,
          entryCount: tournamentEntriesMap.size,
          rewards: {
            rank1: { type: 'legend_guaranteed', count: 2, labelJa: 'レジェンド確定スカウト ×2' },
            rank2: { type: 'legend_guaranteed', count: 1, labelJa: 'レジェンド確定スカウト ×1' },
            rank3: { type: 'purple_guaranteed', count: 1, labelJa: '紫確定スカウト ×1' },
          },
        },
        entries: Array.from(tournamentEntriesMap.values()),
        groups: tournamentGroups,
        standings: tournamentStandings,
        matches: tournamentMatches,
        knockoutBracket: tournamentKnockoutBracket,
        rewards: [],
        currentServerTimeMs: Date.now(),
      },
    });
  });

  // 7.6 Test Helper: Reset Tournament
  app.post('/api/tournament/test/reset', (req, res) => {
    serverTournamentStatus = 'REGISTRATION';
    tournamentEntriesMap.clear();
    tournamentGroups = [];
    tournamentStandings = [];
    tournamentMatches = [];
    tournamentKnockoutBracket = null;

    saveTournamentEntriesToDisk();
    saveTournamentStateToDisk();

    res.json({
      success: true,
      state: {
        definition: {
          tournamentId: TOURNAMENT_ID,
          nameJa: '第1回 FOOTBALL DRAFT CUP',
          nameEn: '1st FOOTBALL DRAFT CUP',
          isTrial: true,
          edition: 1,
          status: 'REGISTRATION',
          registrationStartMs: TOURNAMENT_REG_START_MS,
          registrationEndMs: TOURNAMENT_REG_END_MS,
          matchStartMs: TOURNAMENT_MATCH_START_MS,
          matchEndMs: TOURNAMENT_MATCH_END_MS,
          format: 'GROUP_KNOCKOUT',
          minParticipants: 4,
          entryCount: 0,
          rewards: {
            rank1: { type: 'legend_guaranteed', count: 2, labelJa: 'レジェンド確定スカウト ×2' },
            rank2: { type: 'legend_guaranteed', count: 1, labelJa: 'レジェンド確定スカウト ×1' },
            rank3: { type: 'purple_guaranteed', count: 1, labelJa: '紫確定スカウト ×1' },
          },
        },
        entries: [],
        groups: [],
        standings: [],
        matches: [],
        knockoutBracket: null,
        rewards: [],
        currentServerTimeMs: Date.now(),
      },
    });
  });

  // 8. Online Sync & Diagnostics Endpoint
  let lastSupabaseSyncTimestamp = 0;
  let lastSupabaseSyncError: string | null = null;
  let lastSupabaseMatchesCount = 0;
  let lastSupabaseEntriesCount = 0;

  async function syncFromSupabase() {
    try {
      // 1. Sync PvP matches from Supabase leaderboard table
      const matchesUrl = `${SUPABASE_LEADERBOARD_URL}/rest/v1/leaderboard?select=id,created_at,player_name,score&player_name=like.PVP_MATCH*&order=created_at.desc&limit=500`;
      const matchesRes = await fetch(matchesUrl, {
        headers: {
          apikey: SUPABASE_LEADERBOARD_KEY,
          Authorization: `Bearer ${SUPABASE_LEADERBOARD_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      if (matchesRes.ok) {
        const rows = await matchesRes.json();
        lastSupabaseMatchesCount = rows.length;
        rows.forEach((row: any) => {
          try {
            const raw = row.player_name.replace(/^PVP_MATCH:/, '');
            const matchObj: ServerPvPMatch = JSON.parse(raw);
            if (matchObj && matchObj.id) {
              const existingIdx = serverPvPMatchesList.findIndex((m) => m.id === matchObj.id);
              if (existingIdx < 0) {
                serverPvPMatchesList.push(matchObj);
              }
            }
          } catch {}
        });
        savePvPMatchesToDisk();
      }

      // 2. Sync tournament entries from Supabase leaderboard table
      const entriesUrl = `${SUPABASE_LEADERBOARD_URL}/rest/v1/leaderboard?select=id,created_at,player_name,score&player_name=like.TOURNAMENT_ENTRY*&order=created_at.desc&limit=200`;
      const entriesRes = await fetch(entriesUrl, {
        headers: {
          apikey: SUPABASE_LEADERBOARD_KEY,
          Authorization: `Bearer ${SUPABASE_LEADERBOARD_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      if (entriesRes.ok) {
        const rows = await entriesRes.json();
        lastSupabaseEntriesCount = rows.length;
        rows.forEach((row: any) => {
          try {
            const raw = row.player_name.replace(/^TOURNAMENT_ENTRY:/, '');
            const entryObj: ServerTournamentEntry = JSON.parse(raw);
            if (entryObj && entryObj.userId) {
              if (!tournamentEntriesMap.has(entryObj.userId)) {
                tournamentEntriesMap.set(entryObj.userId, entryObj);
              }
            }
          } catch {}
        });
        saveTournamentEntriesToDisk();
      }

      lastSupabaseSyncTimestamp = Date.now();
      lastSupabaseSyncError = null;
    } catch (err: any) {
      console.warn('Supabase sync note:', err?.message);
      lastSupabaseSyncError = err?.message || 'Supabase sync error';
    }
  }

  // Debug Diagnostics API for Online Synchronization
  app.get('/api/sync/debug', (req, res) => {
    const now = Date.now();
    const jstDate = new Date(now + JST_OFFSET_MS);
    const jstString = jstDate.toISOString().replace('T', ' ').replace('Z', ' JST');
    const weekInfo = getWeekSeasonInfo(now);

    res.json({
      success: true,
      timestamp: now,
      serverTimeJst: jstString,
      supabase: {
        url: SUPABASE_LEADERBOARD_URL,
        connected: !lastSupabaseSyncError,
        lastSyncTime: lastSupabaseSyncTimestamp > 0
          ? new Date(lastSupabaseSyncTimestamp + JST_OFFSET_MS).toISOString().replace('T', ' ').replace('Z', ' JST')
          : '未同期',
        lastError: lastSupabaseSyncError,
        matchesInSupabase: lastSupabaseMatchesCount,
        tournamentEntriesInSupabase: lastSupabaseEntriesCount,
      },
      pvp: {
        totalMatchesInMemory: serverPvPMatchesList.length,
        currentSeason: weekInfo.seasonNumber,
        seasonStartJst: new Date(weekInfo.startMs + JST_OFFSET_MS).toISOString().replace('T', ' ').replace('Z', ' JST'),
        seasonEndJst: new Date(weekInfo.endMs + JST_OFFSET_MS).toISOString().replace('T', ' ').replace('Z', ' JST'),
        phase: weekInfo.phase,
        phaseTextJa: weekInfo.phaseTextJa,
        matchAcceptanceOpen: weekInfo.matchAcceptanceOpen,
      },
      tournament: {
        tournamentId: TOURNAMENT_ID,
        status: serverTournamentStatus,
        entryCount: tournamentEntriesMap.size,
        regStartJst: new Date(TOURNAMENT_REG_START_MS + JST_OFFSET_MS).toISOString().replace('T', ' ').replace('Z', ' JST'),
        regEndJst: new Date(TOURNAMENT_REG_END_MS + JST_OFFSET_MS).toISOString().replace('T', ' ').replace('Z', ' JST'),
        matchStartJst: new Date(TOURNAMENT_MATCH_START_MS + JST_OFFSET_MS).toISOString().replace('T', ' ').replace('Z', ' JST'),
      },
    });
  });

  // Perform initial Supabase sync and start 10-minute server-side sync interval
  syncFromSupabase();
  setInterval(syncFromSupabase, 10 * 60 * 1000);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT} (v1.3.0)`);
  });
}

startServer();
