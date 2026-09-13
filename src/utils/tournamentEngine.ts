import {
  TournamentDefinition,
  TournamentEntry,
  TournamentGroup,
  TournamentStanding,
  TournamentMatch,
  TournamentMatchEvent,
  TournamentKnockoutBracket,
  TournamentRewardGrant,
  TournamentState,
  TournamentStatus,
  GoalPatternType,
} from '../types/tournament';
import { UserTeam, TeamTactics, Player } from '../types';
import { evaluateTacticalAdvantage, pickRealisticGoalScorer } from './pvpEngine';
import { getPlayerHeight } from '../data/playerHeights';
import { getTeamEffectiveOvr } from './positionEngine';

// JST Dates for FD_CUP_001 (Strict JST: UTC+9)
// Entry period: 2026-09-13 00:00:00 JST to 2026-09-18 23:59:59.999 JST
// Tournament Start: 2026-09-19 00:00:00 JST to 2026-09-25 23:59:59.999 JST
export const FD_CUP_001_REG_START_MS = Date.UTC(2026, 8, 12, 15, 0, 0); // 2026-09-13 00:00:00 JST
export const FD_CUP_001_REG_END_MS = Date.UTC(2026, 8, 18, 14, 59, 59, 999); // 2026-09-18 23:59:59.999 JST
export const FD_CUP_001_MATCH_START_MS = Date.UTC(2026, 8, 18, 15, 0, 0); // 2026-09-19 00:00:00 JST
export const FD_CUP_001_MATCH_END_MS = Date.UTC(2026, 8, 25, 14, 59, 59, 999); // 2026-09-25 23:59:59.999 JST

export const INITIAL_TOURNAMENT_FD_CUP_001: TournamentDefinition = {
  tournamentId: 'FD_CUP_001',
  nameJa: '第1回 FOOTBALL DRAFT CUP',
  nameEn: '1st FOOTBALL DRAFT CUP',
  isTrial: true,
  edition: 1,
  status: 'REGISTRATION',
  registrationStartMs: FD_CUP_001_REG_START_MS,
  registrationEndMs: FD_CUP_001_REG_END_MS,
  matchStartMs: FD_CUP_001_MATCH_START_MS,
  matchEndMs: FD_CUP_001_MATCH_END_MS,
  format: 'GROUP_KNOCKOUT',
  minParticipants: 4,
  entryCount: 0,
  rewards: {
    rank1: { type: 'legend_guaranteed', count: 2, labelJa: 'レジェンド確定スカウト ×2' },
    rank2: { type: 'legend_guaranteed', count: 1, labelJa: 'レジェンド確定スカウト ×1' },
    rank3: { type: 'purple_guaranteed', count: 1, labelJa: '紫確定スカウト ×1' },
  },
};

export const STORAGE_KEY_TOURNAMENT_TACTICS = 'FOOTBALL_DRAFT_TOURNAMENT_TACTICS_v131';
export const STORAGE_KEY_TOURNAMENT_STATE_CACHE = 'FOOTBALL_DRAFT_TOURNAMENT_CACHE_v131';

/**
 * Determine tournament status based on authoritative server timestamp
 */
export function determineTournamentStatus(
  currentMs: number,
  baseDef: TournamentDefinition = INITIAL_TOURNAMENT_FD_CUP_001
): TournamentStatus {
  if (currentMs < baseDef.registrationStartMs) {
    return 'DRAFT';
  }
  if (currentMs <= baseDef.registrationEndMs) {
    return 'REGISTRATION';
  }
  if (currentMs < baseDef.matchStartMs) {
    return 'LOCKED';
  }
  if (currentMs <= baseDef.matchEndMs) {
    return 'GROUP_STAGE';
  }
  return 'COMPLETED';
}

/**
 * Load tournament-specific saved tactics from localStorage
 * Kept strictly isolated from normal PvP tactics.
 */
export function getSavedTournamentTactics(): TeamTactics {
  const fallback: TeamTactics = {
    attackTactic: 'POSSESSION',
    defenseTactic: 'MID_BLOCK',
    attackDirection: 'BALANCED',
    pressIntensity: 'BALANCED',
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TOURNAMENT_TACTICS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          attackTactic: parsed.attackTactic || fallback.attackTactic,
          defenseTactic: parsed.defenseTactic || fallback.defenseTactic,
          attackDirection: parsed.attackDirection || fallback.attackDirection,
          pressIntensity: parsed.pressIntensity || fallback.pressIntensity,
        };
      }
    }
  } catch (e) {
    console.warn('Failed to load tournament tactics cache', e);
  }
  return fallback;
}

/**
 * Save tournament-specific tactics
 */
export function saveTournamentTactics(tactics: TeamTactics): void {
  try {
    const safe: TeamTactics = {
      attackTactic: tactics?.attackTactic || 'POSSESSION',
      defenseTactic: tactics?.defenseTactic || 'MID_BLOCK',
      attackDirection: tactics?.attackDirection || 'BALANCED',
      pressIntensity: tactics?.pressIntensity || 'BALANCED',
    };
    localStorage.setItem(STORAGE_KEY_TOURNAMENT_TACTICS, JSON.stringify(safe));
  } catch (e) {
    console.warn('Failed to save tournament tactics', e);
  }
}

/**
 * Generate diverse goal patterns
 */
export function pickGoalPattern(attackTactic: string): GoalPatternType {
  const roll = Math.random();
  if (attackTactic === 'CROSS_GAME' || attackTactic === 'WIDE_ATTACK') {
    if (roll < 0.50) return 'CROSS';
    if (roll < 0.70) return 'CORNER_KICK';
    if (roll < 0.85) return 'LOOSE_BALL';
    return 'MIDDLE_SHOT';
  }
  if (attackTactic === 'COUNTER' || attackTactic === 'LONG_COUNTER' || attackTactic === 'QUICK_ATTACK') {
    if (roll < 0.45) return 'COUNTER';
    if (roll < 0.75) return 'THROUGH_PASS';
    if (roll < 0.90) return 'MIDDLE_SHOT';
    return 'LOOSE_BALL';
  }
  if (attackTactic === 'TIKI_TAKA' || attackTactic === 'SHORT_PASS' || attackTactic === 'POSSESSION') {
    if (roll < 0.45) return 'CENTRAL_BREAKTHROUGH';
    if (roll < 0.75) return 'THROUGH_PASS';
    if (roll < 0.90) return 'MIDDLE_SHOT';
    return 'FREE_KICK';
  }
  // Default distribution
  if (roll < 0.20) return 'CROSS';
  if (roll < 0.40) return 'THROUGH_PASS';
  if (roll < 0.55) return 'MIDDLE_SHOT';
  if (roll < 0.70) return 'COUNTER';
  if (roll < 0.85) return 'CENTRAL_BREAKTHROUGH';
  if (roll < 0.92) return 'CORNER_KICK';
  if (roll < 0.97) return 'FREE_KICK';
  return 'LOOSE_BALL';
}

export function getGoalPatternDescriptionJa(
  pattern: GoalPatternType,
  scorerName: string,
  scorerRole: string,
  height: number,
  isHeader?: boolean
): string {
  switch (pattern) {
    case 'CROSS':
      return isHeader
        ? `⚽ GOOOAL!! サイドからの高精度クロスに${scorerRole} ${scorerName}（身長${height}cm）が打点の高いヘディングで合わせゴールネットを揺らす！`
        : `⚽ GOAL!! サイドを崩した高速クロスに${scorerRole} ${scorerName}がボレーで合わせて豪快にネットを揺らす！`;
    case 'THROUGH_PASS':
      return `⚽ GOAL!! 絶妙なタイミングのスルーパスに抜け出した${scorerRole} ${scorerName}がGKとの1対1を冷静に制してゴール！`;
    case 'MIDDLE_SHOT':
      return `⚽ GOOOAL!! ペナルティエリア手前から${scorerRole} ${scorerName}の強烈なミドルシュートがゴール隅へ突き刺さる！`;
    case 'COUNTER':
      return `⚽ GOAL!! 相手の攻撃を奪ってからの電光石火のカウンター！ ${scorerRole} ${scorerName}が独走して追加点を奪う！`;
    case 'CENTRAL_BREAKTHROUGH':
      return `⚽ GOAL!! 中央でのワンツーパスの連係で相手守備網を完全崩壊！ ${scorerRole} ${scorerName}が美しくフィニッシュ！`;
    case 'CORNER_KICK':
      return `⚽ GOAL!! コーナーキックからゴール前の混戦で${scorerRole} ${scorerName}（身長${height}cm）が競り勝ち、頭で押し込む！`;
    case 'FREE_KICK':
      return `⚽ GOOOAL!! 危険な位置からのフリーキックを${scorerRole} ${scorerName}が直接壁の上を越えてネットに突き刺す！`;
    case 'LOOSE_BALL':
      return `⚽ GOAL!! シュートのこぼれ球にいち早く反応した${scorerRole} ${scorerName}が泥臭く押し込んでゴール！`;
  }
}

/**
 * SIMULATE TOURNAMENT MATCH
 * - "Tactics vs Tactics" is the core driver
 * - Lower OVR can defeat higher OVR with superior tactical counter & setup
 * - Higher OVR is not guaranteed to win
 * - Diverse goal patterns
 * - Full detailed match timeline and tactical breakdown
 */
export function simulateTournamentMatch(
  homeEntry: TournamentEntry,
  awayEntry: TournamentEntry,
  stage: TournamentMatch['stage'],
  round: number,
  tournamentId: string = 'FD_CUP_001',
  groupId?: string
): TournamentMatch {
  const homeSquad = homeEntry.teamSnapshot;
  const awaySquad = awayEntry.teamSnapshot;
  const homeTactics = homeEntry.tacticsSnapshot;
  const awayTactics = awayEntry.tacticsSnapshot;

  const homePlayers = homeSquad?.players || [];
  const awayPlayers = awaySquad?.players || [];

  const homeOvr = getTeamEffectiveOvr(homeSquad);
  const awayOvr = getTeamEffectiveOvr(awaySquad);

  // Evaluate tactical advantages & counter matchups
  const homeTacticalEval = evaluateTacticalAdvantage(homeTactics, awayTactics, homeSquad, awaySquad);
  const awayTacticalEval = evaluateTacticalAdvantage(awayTactics, homeTactics, awaySquad, homeSquad);

  // Net tactical advantage:
  // Ranges roughly between -0.7 to +0.7
  const netTacticalAdvantage = homeTacticalEval.userAdvantage - awayTacticalEval.userAdvantage;

  // OVR weight is secondary (0.012 per OVR point difference)
  // For example: 5 OVR gap = 0.06; a strong tactical counter (+0.35) easily overcomes a 10 OVR gap!
  const netAdvantage = netTacticalAdvantage + (homeOvr - awayOvr) * 0.012;

  // Realistic score generation based on tactical flow
  let homeScore = 0;
  let awayScore = 0;

  // Goal expectancy base
  const homeChance = Math.max(0.15, Math.min(0.85, 0.45 + netAdvantage * 0.55));
  const awayChance = Math.max(0.15, Math.min(0.85, 0.45 - netAdvantage * 0.55));

  // Determine scores (0 to 4 goals per side)
  const rollHome = Math.random();
  if (rollHome < homeChance * 0.35) {
    homeScore = 3 + (Math.random() < 0.2 ? 1 : 0);
  } else if (rollHome < homeChance * 0.75) {
    homeScore = 2;
  } else if (rollHome < homeChance * 1.15) {
    homeScore = 1;
  } else {
    homeScore = 0;
  }

  const rollAway = Math.random();
  if (rollAway < awayChance * 0.35) {
    awayScore = 3 + (Math.random() < 0.2 ? 1 : 0);
  } else if (rollAway < awayChance * 0.75) {
    awayScore = 2;
  } else if (rollAway < awayChance * 1.15) {
    awayScore = 1;
  } else {
    awayScore = 0;
  }

  // Generate Match Events
  const events: TournamentMatchEvent[] = [];

  events.push({
    minute: 1,
    type: 'whistle',
    textJa: `主審の笛で${getStageNameJa(stage)}キックオフ！ [${homeEntry.displayName} (OVR ${homeOvr}) vs ${awayEntry.displayName} (OVR ${awayOvr})]`,
    textEn: `Kickoff! Match underway!`,
  });

  // Tactical encounter minute
  events.push({
    minute: 18,
    type: 'tactic',
    textJa: `${homeEntry.displayName}: [${homeTactics.attackTactic} × ${homeTactics.defenseTactic}] vs ${awayEntry.displayName}: [${awayTactics.attackTactic} × ${awayTactics.defenseTactic}]。${homeTacticalEval.explanationJa}`,
    textEn: 'Tactical clash unfolds.',
  });

  // Distribute Home goals
  for (let g = 0; g < homeScore; g++) {
    const scorerData = pickRealisticGoalScorer(homePlayers);
    const scorer = scorerData?.player;
    const scorerName = scorer?.nameJa || homeEntry.displayName;
    const scorerRole = scorer?.subPosition || scorer?.position || 'FW';
    const height = scorer ? getPlayerHeight(scorer) : 180;
    const pattern = pickGoalPattern(homeTactics.attackTactic);
    const minute = Math.min(88, Math.max(8, Math.round(15 + g * 28 + (Math.random() * 12 - 6))));

    events.push({
      minute,
      type: 'goal',
      scorerName,
      scorerTeam: 'HOME',
      goalPattern: pattern,
      textJa: getGoalPatternDescriptionJa(pattern, `${homeEntry.displayName}の${scorerName}`, scorerRole, height, scorerData?.isHeader),
    });
  }

  // Distribute Away goals
  for (let g = 0; g < awayScore; g++) {
    const scorerData = pickRealisticGoalScorer(awayPlayers);
    const scorer = scorerData?.player;
    const scorerName = scorer?.nameJa || awayEntry.displayName;
    const scorerRole = scorer?.subPosition || scorer?.position || 'FW';
    const height = scorer ? getPlayerHeight(scorer) : 180;
    const pattern = pickGoalPattern(awayTactics.attackTactic);
    const minute = Math.min(89, Math.max(12, Math.round(22 + g * 26 + (Math.random() * 14 - 7))));

    events.push({
      minute,
      type: 'goal',
      scorerName,
      scorerTeam: 'AWAY',
      goalPattern: pattern,
      textJa: getGoalPatternDescriptionJa(pattern, `${awayEntry.displayName}の${scorerName}`, scorerRole, height, scorerData?.isHeader),
    });
  }

  // For knockout matches, ensure a winner via PK if regular time is drawn
  let homePenaltyScore: number | undefined;
  let awayPenaltyScore: number | undefined;
  let winnerUserId: string | undefined;

  const isKnockoutStage = ['ROUND_OF_16', 'QUARTER_FINAL', 'SEMI_FINAL', 'THIRD_PLACE', 'FINAL'].includes(stage);

  if (isKnockoutStage && homeScore === awayScore) {
    // Penalty shootout
    let pHome = 3 + Math.floor(Math.random() * 3); // 3-5
    let pAway = 3 + Math.floor(Math.random() * 3);
    if (pHome === pAway) {
      if (Math.random() < 0.5) pHome += 1;
      else pAway += 1;
    }
    homePenaltyScore = pHome;
    awayPenaltyScore = pAway;
    winnerUserId = pHome > pAway ? homeEntry.userId : awayEntry.userId;

    events.push({
      minute: 90,
      type: 'whistle',
      textJa: `前後半90分終了！ ${homeScore} - ${awayScore}の同点のためPK戦に突入！`,
    });

    events.push({
      minute: 95,
      type: 'penalty',
      textJa: `PK戦結果: ${pHome} - ${pAway}！ 激闘を制し${winnerUserId === homeEntry.userId ? homeEntry.displayName : awayEntry.displayName}が勝利！`,
    });
  } else {
    if (homeScore > awayScore) winnerUserId = homeEntry.userId;
    else if (awayScore > homeScore) winnerUserId = awayEntry.userId;
    else winnerUserId = undefined; // Draw allowed in group/round-robin
  }

  events.sort((a, b) => a.minute - b.minute);

  events.push({
    minute: 90,
    type: 'whistle',
    textJa: `試合終了！ 最終結果: ${homeScore} - ${awayScore}${homePenaltyScore !== undefined ? ` (PK ${homePenaltyScore}-${awayPenaltyScore})` : ''}`,
  });

  const stageNameJa = getStageNameJa(stage);
  const matchId = `tmatch_${tournamentId}_${stage}_${round}_${homeEntry.userId.slice(0, 5)}_${awayEntry.userId.slice(0, 5)}_${Date.now()}`;

  const tacticalAnalysisJa = `【戦術分析】${homeEntry.displayName} (${homeTactics.attackTactic} / ${homeTactics.defenseTactic}) vs ${awayEntry.displayName} (${awayTactics.attackTactic} / ${awayTactics.defenseTactic})。\n${homeTacticalEval.explanationJa}\n総合値差(OVR ${homeOvr} vs ${awayOvr})に対し、${Math.abs(netTacticalAdvantage) > 0.2 ? '戦術相性が大きく試合展開を左右しました。' : '両者の戦術が拮抗した緊迫の展開となりました。'}`;

  return {
    matchId,
    tournamentId,
    stage,
    stageNameJa,
    groupId,
    round,
    homeUserId: homeEntry.userId,
    homeDisplayName: homeEntry.displayName,
    awayUserId: awayEntry.userId,
    awayDisplayName: awayEntry.displayName,
    homeScore,
    awayScore,
    homePenaltyScore,
    awayPenaltyScore,
    winnerUserId,
    homeTactics,
    awayTactics,
    homeTeamSnapshot: homeSquad,
    awayTeamSnapshot: awaySquad,
    status: 'COMPLETED',
    createdAt: Date.now() - 60000,
    completedAt: Date.now(),
    events,
    tacticalAnalysisJa,
  };
}

export function getStageNameJa(stage: TournamentMatch['stage']): string {
  switch (stage) {
    case 'ROUND_ROBIN':
      return '総当たり戦';
    case 'GROUP':
      return 'グループステージ';
    case 'ROUND_OF_16':
      return 'ベスト16';
    case 'QUARTER_FINAL':
      return '準々決勝';
    case 'SEMI_FINAL':
      return '準決勝';
    case 'THIRD_PLACE':
      return '3位決定戦';
    case 'FINAL':
      return '決勝戦';
  }
}

/**
 * Generate Groups from Entrants
 * Equal division into Group A, B, C, D...
 */
export function partitionIntoGroups(entries: TournamentEntry[]): TournamentGroup[] {
  const count = entries.length;
  let numGroups = 2;
  if (count >= 16) numGroups = 4;
  else if (count >= 12) numGroups = 3;
  else if (count >= 8) numGroups = 2;

  const groupLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
  const groups: TournamentGroup[] = Array.from({ length: numGroups }, (_, i) => ({
    groupId: `GROUP_${groupLabels[i]}`,
    groupNameJa: `グループ ${groupLabels[i]}`,
    groupNameEn: `Group ${groupLabels[i]}`,
    participantUserIds: [],
  }));

  // Distribute entries evenly
  entries.forEach((entry, idx) => {
    const targetGroup = groups[idx % numGroups];
    targetGroup.participantUserIds.push(entry.userId);
  });

  return groups;
}

/**
 * Calculate Standings for a given group or round-robin
 * Rule: 3 pts for Win, 1 pt for Draw, 0 pt for Loss.
 * Ranking order:
 * 1. Points
 * 2. Goal Difference
 * 3. Goals For
 * 4. Total Wins
 */
export function calculateStandings(
  entries: TournamentEntry[],
  matches: TournamentMatch[],
  groupId?: string
): TournamentStanding[] {
  const map = new Map<string, TournamentStanding>();

  const filteredEntries = groupId
    ? entries.filter((e) => {
        // Find if entry belongs to this group via matches or caller
        return matches.some(
          (m) => m.groupId === groupId && (m.homeUserId === e.userId || m.awayUserId === e.userId)
        );
      })
    : entries;

  filteredEntries.forEach((entry) => {
    map.set(entry.userId, {
      tournamentId: entry.tournamentId,
      groupId,
      userId: entry.userId,
      displayName: entry.displayName,
      teamName: entry.teamSnapshot?.name || 'My Squad',
      teamOvr: entry.teamOvr || 85,
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

  const relevantMatches = matches.filter(
    (m) => m.status === 'COMPLETED' && (!groupId || m.groupId === groupId)
  );

  relevantMatches.forEach((m) => {
    const home = map.get(m.homeUserId);
    const away = map.get(m.awayUserId);

    if (home) {
      home.matchesPlayed += 1;
      home.goalsFor += m.homeScore;
      home.goalsAgainst += m.awayScore;
      home.goalDifference = home.goalsFor - home.goalsAgainst;
      if (m.homeScore > m.awayScore) {
        home.wins += 1;
        home.points += 3;
      } else if (m.homeScore === m.awayScore) {
        home.draws += 1;
        home.points += 1;
      } else {
        home.losses += 1;
      }
    }

    if (away) {
      away.matchesPlayed += 1;
      away.goalsFor += m.awayScore;
      away.goalsAgainst += m.homeScore;
      away.goalDifference = away.goalsFor - away.goalsAgainst;
      if (m.awayScore > m.homeScore) {
        away.wins += 1;
        away.points += 3;
      } else if (m.awayScore === m.homeScore) {
        away.draws += 1;
        away.points += 1;
      } else {
        away.losses += 1;
      }
    }
  });

  const list = Array.from(map.values());

  // Strict sorting rules
  list.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.teamOvr - a.teamOvr;
  });

  // Top 2 in each group advance to Knockout
  return list.map((item, idx) => ({
    ...item,
    rank: idx + 1,
    isQualified: idx < 2,
  }));
}

/**
 * Generate Round-Robin schedule (every pair plays exactly once)
 */
export function generateRoundRobinMatches(
  entries: TournamentEntry[],
  tournamentId: string = 'FD_CUP_001',
  groupId?: string
): { homeEntry: TournamentEntry; awayEntry: TournamentEntry; round: number }[] {
  const pairs: { homeEntry: TournamentEntry; awayEntry: TournamentEntry; round: number }[] = [];
  const n = entries.length;
  let roundNum = 1;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairs.push({
        homeEntry: entries[i],
        awayEntry: entries[j],
        round: roundNum++,
      });
    }
  }
  return pairs;
}

/**
 * Build Knockout Bracket from qualified participants
 */
export function buildKnockoutMatches(
  qualifiedEntries: TournamentEntry[],
  tournamentId: string = 'FD_CUP_001'
): TournamentKnockoutBracket {
  const matches: TournamentMatch[] = [];
  const n = qualifiedEntries.length;

  if (n < 2) {
    return { quarterFinals: [], semiFinals: [] };
  }

  // If 8 qualifiers: Quarter Finals -> Semi Finals -> 3rd Place -> Final
  // If 4 qualifiers: Semi Finals -> 3rd Place -> Final
  // If 2 qualifiers: Final only
  if (n >= 8) {
    // 4 Quarter Finals
    const qfMatches: TournamentMatch[] = [];
    for (let i = 0; i < 4; i++) {
      const home = qualifiedEntries[i];
      const away = qualifiedEntries[7 - i];
      if (home && away) {
        const m = simulateTournamentMatch(home, away, 'QUARTER_FINAL', i + 1, tournamentId);
        qfMatches.push(m);
      }
    }

    // Semi Finals from QF winners
    const sfWinners = qfMatches.map((m) =>
      qualifiedEntries.find((e) => e.userId === m.winnerUserId) || qualifiedEntries[0]
    );

    const sfMatches: TournamentMatch[] = [
      simulateTournamentMatch(sfWinners[0], sfWinners[1], 'SEMI_FINAL', 1, tournamentId),
      simulateTournamentMatch(sfWinners[2], sfWinners[3], 'SEMI_FINAL', 2, tournamentId),
    ];

    const finalWinners = sfMatches.map((m) =>
      qualifiedEntries.find((e) => e.userId === m.winnerUserId) || sfWinners[0]
    );
    const sfLosers = sfMatches.map((m) =>
      qualifiedEntries.find((e) => e.userId !== m.winnerUserId) || sfWinners[1]
    );

    const thirdPlaceMatch = simulateTournamentMatch(
      sfLosers[0],
      sfLosers[1],
      'THIRD_PLACE',
      1,
      tournamentId
    );

    const finalMatch = simulateTournamentMatch(
      finalWinners[0],
      finalWinners[1],
      'FINAL',
      1,
      tournamentId
    );

    const champion = qualifiedEntries.find((e) => e.userId === finalMatch.winnerUserId);
    const runnerUp = qualifiedEntries.find((e) => e.userId !== finalMatch.winnerUserId && (e.userId === finalWinners[0].userId || e.userId === finalWinners[1].userId));
    const thirdPlaceWinner = qualifiedEntries.find((e) => e.userId === thirdPlaceMatch.winnerUserId);

    return {
      quarterFinals: qfMatches,
      semiFinals: sfMatches,
      thirdPlaceMatch,
      finalMatch,
      champion,
      runnerUp,
      thirdPlaceWinner,
    };
  }

  // 4 qualifiers
  if (n >= 4) {
    const sf1 = simulateTournamentMatch(qualifiedEntries[0], qualifiedEntries[3], 'SEMI_FINAL', 1, tournamentId);
    const sf2 = simulateTournamentMatch(qualifiedEntries[1], qualifiedEntries[2], 'SEMI_FINAL', 2, tournamentId);

    const finalist1 = qualifiedEntries.find((e) => e.userId === sf1.winnerUserId) || qualifiedEntries[0];
    const finalist2 = qualifiedEntries.find((e) => e.userId === sf2.winnerUserId) || qualifiedEntries[1];

    const loser1 = qualifiedEntries.find((e) => e.userId !== sf1.winnerUserId) || qualifiedEntries[3];
    const loser2 = qualifiedEntries.find((e) => e.userId !== sf2.winnerUserId) || qualifiedEntries[2];

    const thirdPlaceMatch = simulateTournamentMatch(loser1, loser2, 'THIRD_PLACE', 1, tournamentId);
    const finalMatch = simulateTournamentMatch(finalist1, finalist2, 'FINAL', 1, tournamentId);

    const champion = qualifiedEntries.find((e) => e.userId === finalMatch.winnerUserId);
    const runnerUp = qualifiedEntries.find((e) => e.userId !== finalMatch.winnerUserId && (e.userId === finalist1.userId || e.userId === finalist2.userId));
    const thirdPlaceWinner = qualifiedEntries.find((e) => e.userId === thirdPlaceMatch.winnerUserId);

    return {
      quarterFinals: [],
      semiFinals: [sf1, sf2],
      thirdPlaceMatch,
      finalMatch,
      champion,
      runnerUp,
      thirdPlaceWinner,
    };
  }

  // 2 qualifiers -> direct final
  const finalMatch = simulateTournamentMatch(qualifiedEntries[0], qualifiedEntries[1], 'FINAL', 1, tournamentId);
  const champion = qualifiedEntries.find((e) => e.userId === finalMatch.winnerUserId);
  const runnerUp = qualifiedEntries.find((e) => e.userId !== finalMatch.winnerUserId);

  return {
    quarterFinals: [],
    semiFinals: [],
    finalMatch,
    champion,
    runnerUp,
  };
}
