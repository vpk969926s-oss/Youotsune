import {
  UserTeam,
  BetaUserProfile,
  BetaMatchRecord,
  BetaMatchEvent,
  BetaStandingEntry,
  TeamTactics,
  AttackTactics,
  DefenseTactics,
  Player,
} from '../types';
import { getPersistentUserId, getSavedUserHandle } from './supabasePvP';
import { getPlayerHeight } from '../data/playerHeights';
import { getTeamEffectiveOvr, getPvPSimulationOvr } from './positionEngine';
import { getSeasonNumberForTimestamp } from './seasonEngine';
import {
  getTacticalDefenseSquad,
  getOVRDefenseSquad,
  getTacticalDefenseTactics,
} from './defenseSquadEngine';

export const STORAGE_KEY_PVP_USER = 'FOOTBALL_DRAFT_PVP_USER_v113';
export const STORAGE_KEY_PVP_MATCH_HISTORY = 'FOOTBALL_DRAFT_PVP_HISTORY_v113';
export const STORAGE_KEY_PVP_COMMUNITY_USERS = 'FOOTBALL_DRAFT_PVP_COMMUNITY_USERS_v113';
export const STORAGE_KEY_DEFENSE_SQUAD_ID = 'FOOTBALL_DRAFT_DEFENSE_SQUAD_ID_v113';

export const DEFAULT_TACTICS: TeamTactics = {
  attackTactic: 'POSSESSION',
  defenseTactic: 'MID_BLOCK',
  attackDirection: 'BALANCED',
  pressIntensity: 'BALANCED',
};

// Community users registry
export const INITIAL_COMMUNITY_USERS: BetaUserProfile[] = [];

const LEGACY_CPU_USER_IDS = new Set(['usr_tikitaka_king', 'usr_galactico_ace', 'usr_samurai_legend']);
const LEGACY_CPU_USERNAMES = new Set(['tikitakamaster', 'galacticoking', 'samuraiblue93']);

/**
 * Get current configured defense squad ID
 */
export function getDefenseSquadId(teams?: UserTeam[]): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_DEFENSE_SQUAD_ID);
    if (saved && teams && teams.some((t) => t.teamId === saved)) {
      return saved;
    }
  } catch (e) {
    console.error('Failed to load defense squad id', e);
  }
  return teams && teams.length > 0 ? teams[0].teamId : '';
}

/**
 * Set and persist defense squad
 */
export function setDefenseSquad(
  squadId: string,
  teams: UserTeam[],
  tactics?: TeamTactics
): { success: boolean; team?: UserTeam } {
  try {
    const targetTeam = teams.find((t) => t.teamId === squadId);
    if (!targetTeam) return { success: false };

    localStorage.setItem(STORAGE_KEY_DEFENSE_SQUAD_ID, squadId);

    const currentUser = getCurrentUserProfile(targetTeam, teams);
    const updatedProfile: BetaUserProfile = {
      ...currentUser,
      team: targetTeam,
      defenseSquadId: squadId,
      tactics: tactics || currentUser.tactics || DEFAULT_TACTICS,
      updatedAt: Date.now(),
    };

    saveRegisteredUser(updatedProfile);
    return { success: true, team: targetTeam };
  } catch (e) {
    console.error('Failed to set defense squad', e);
    return { success: false };
  }
}

/**
 * Load all registered real users from local storage
 */
export function getRegisteredUsers(): BetaUserProfile[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_PVP_COMMUNITY_USERS);
    if (saved) {
      const parsed: BetaUserProfile[] = JSON.parse(saved);
      const cleanUsers = parsed.filter(
        (u) =>
          u &&
          u.userId &&
          !LEGACY_CPU_USER_IDS.has(u.userId) &&
          !LEGACY_CPU_USERNAMES.has((u.username || '').toLowerCase().trim())
      );
      return cleanUsers;
    }
  } catch (e) {
    console.error('Failed to load community users', e);
  }
  return [];
}

/**
 * Save user profile to community registry
 */
export function saveRegisteredUser(profile: BetaUserProfile): { success: boolean; error?: string } {
  const users = getRegisteredUsers();
  const trimmed = profile.username.trim();

  if (!trimmed || trimmed.length < 3) {
    return { success: false, error: 'ユーザーネームは3文字以上で入力してください。' };
  }

  const updatedUsers = users.filter((u) => u.userId !== profile.userId);
  updatedUsers.push({ ...profile, username: trimmed, updatedAt: Date.now() });

  try {
    localStorage.setItem(STORAGE_KEY_PVP_COMMUNITY_USERS, JSON.stringify(updatedUsers));
    localStorage.setItem(STORAGE_KEY_PVP_USER, JSON.stringify({ ...profile, username: trimmed }));
    return { success: true };
  } catch (e) {
    console.error('Failed to save user profile', e);
    return { success: false, error: '保存に失敗しました。' };
  }
}

/**
 * Get current user's saved profile
 */
export function getCurrentUserProfile(
  activeTeam?: UserTeam | null,
  teams?: UserTeam[]
): BetaUserProfile {
  const persistentId = getPersistentUserId();
  const savedHandle = getSavedUserHandle();
  const tacticalDef = getTacticalDefenseSquad(activeTeam || undefined, teams);
  const ovrDef = getOVRDefenseSquad(activeTeam || undefined, teams);
  const tacticalTactics = getTacticalDefenseTactics();

  try {
    const saved = localStorage.getItem(STORAGE_KEY_PVP_USER);
    const defSquadId = getDefenseSquadId(teams);
    const defenseTeam =
      teams && defSquadId
        ? teams.find((t) => t.teamId === defSquadId) || activeTeam
        : activeTeam;

    if (saved) {
      const parsed: BetaUserProfile = JSON.parse(saved);
      return {
        ...parsed,
        userId: parsed.userId || persistentId,
        username: parsed.username || savedHandle,
        team: defenseTeam || parsed.team,
        tacticalDefenseSquad: tacticalDef || parsed.tacticalDefenseSquad || defenseTeam || parsed.team,
        ovrDefenseSquad: ovrDef || parsed.ovrDefenseSquad || defenseTeam || parsed.team,
        defenseSquadId: defSquadId || parsed.defenseSquadId,
        tactics: tacticalTactics || parsed.tactics || DEFAULT_TACTICS,
      };
    }
  } catch (e) {
    console.error('Failed to load current user profile', e);
  }

  return {
    userId: persistentId,
    username: savedHandle,
    team: activeTeam,
    tacticalDefenseSquad: tacticalDef || activeTeam || undefined,
    ovrDefenseSquad: ovrDef || activeTeam || undefined,
    defenseSquadId: activeTeam?.teamId,
    tactics: tacticalTactics || DEFAULT_TACTICS,
    updatedAt: Date.now(),
  };
}

/**
 * Match History Management
 */
export function getMyMatchHistory(): BetaMatchRecord[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_PVP_MATCH_HISTORY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to load match history', e);
  }
  return [];
}

export function saveMyMatchRecord(record: BetaMatchRecord): void {
  const history = getMyMatchHistory();
  const updated = [record, ...history.filter((m) => m.id !== record.id)];
  try {
    localStorage.setItem(STORAGE_KEY_PVP_MATCH_HISTORY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save match record', e);
  }
}

/**
 * Calculate Standings for a specific season and match type, merging registered users and matches
 */
export function computeWeeklyStandings(
  allUsers: BetaUserProfile[],
  currentUser: BetaUserProfile,
  allSeasonMatches: BetaMatchRecord[],
  targetSeason: number,
  matchTypeFilter: 'ALL' | 'OVR' | 'TACTICAL' = 'ALL'
): BetaStandingEntry[] {
  const allUsersMap = new Map<string, BetaStandingEntry>();

  // Ensure current user is in the list
  const combinedUsers = [...allUsers];
  if (!combinedUsers.some((u) => u.userId === currentUser.userId)) {
    combinedUsers.push(currentUser);
  }

  // Filter matches for the specific season and match type, with strict unique match ID deduplication
  const seenMatchIds = new Set<string>();
  const seasonMatches = allSeasonMatches.filter((m) => {
    if (!m) return false;
    const matchKey = m.id;
    if (matchKey) {
      if (seenMatchIds.has(matchKey)) return false;
      seenMatchIds.add(matchKey);
    }
    const sNum = m.season || getSeasonNumberForTimestamp(m.timestamp);
    const matchesSeason = sNum === targetSeason;
    const matchesType = matchTypeFilter === 'ALL' || m.matchType === matchTypeFilter;
    return matchesSeason && matchesType;
  });

  // Seed every registered user
  combinedUsers.forEach((u) => {
    if (!u || !u.username) return;
    const teamOvr = u.team ? getTeamEffectiveOvr(u.team) : 85;

    allUsersMap.set(u.userId, {
      userId: u.userId,
      username: u.username,
      teamName: u.team?.name || 'Best XI',
      teamOvr,
      points: 0,
      goalDifference: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      matchesCount: 0,
      recent10Matches: [],
      season: targetSeason,
    });
  });

  // Aggregate stats from matches
  seasonMatches.forEach((m) => {
    // Challenger Entry
    const cEntry = allUsersMap.get(m.challengerUserId) || {
      userId: m.challengerUserId,
      username: m.challengerUsername,
      teamName: m.challengerTeamName || 'Best XI',
      teamOvr: m.challengerOvr || 85,
      points: 0,
      goalDifference: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      matchesCount: 0,
      recent10Matches: [],
      season: targetSeason,
    };

    cEntry.matchesCount += 1;
    cEntry.goalsFor += m.challengerScore;
    cEntry.goalsAgainst += m.opponentScore;
    cEntry.goalDifference = cEntry.goalsFor - cEntry.goalsAgainst;
    cEntry.recent10Matches.unshift(m);

    if (m.challengerScore > m.opponentScore) {
      cEntry.wins += 1;
      cEntry.points += 3;
    } else if (m.challengerScore === m.opponentScore) {
      cEntry.draws += 1;
      cEntry.points += 1;
    } else {
      cEntry.losses += 1;
    }
    allUsersMap.set(m.challengerUserId, cEntry);

    // Opponent Entry
    const oEntry = allUsersMap.get(m.opponentUserId) || {
      userId: m.opponentUserId,
      username: m.opponentUsername,
      teamName: m.opponentTeamName || 'Opponent XI',
      teamOvr: m.opponentOvr || 85,
      points: 0,
      goalDifference: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      matchesCount: 0,
      recent10Matches: [],
      season: targetSeason,
    };

    oEntry.matchesCount += 1;
    oEntry.goalsFor += m.opponentScore;
    oEntry.goalsAgainst += m.challengerScore;
    oEntry.goalDifference = oEntry.goalsFor - oEntry.goalsAgainst;

    if (m.opponentScore > m.challengerScore) {
      oEntry.wins += 1;
      oEntry.points += 3;
    } else if (m.opponentScore === m.challengerScore) {
      oEntry.draws += 1;
      oEntry.points += 1;
    } else {
      oEntry.losses += 1;
    }
    allUsersMap.set(m.opponentUserId, oEntry);
  });

  const list = Array.from(allUsersMap.values());

  // Sort by strictly deterministic tiebreaker:
  // 1. Points DESC
  // 2. Goal Difference DESC
  // 3. Goals For DESC
  // 4. Total Wins DESC
  // 5. Team OVR DESC
  // 6. User ID deterministic fallback
  list.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.teamOvr !== a.teamOvr) return b.teamOvr - a.teamOvr;
    return a.userId.localeCompare(b.userId);
  });

  return list.map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

/**
 * TACTICAL COUNTER EVALUATION ENGINE
 * Calculates detailed tactical synergy, counter advantages, player height & attributes
 */
export function evaluateTacticalAdvantage(
  userTac: TeamTactics,
  oppTac: TeamTactics,
  userSquad?: UserTeam | null,
  oppSquad?: UserTeam | null
): {
  userAdvantage: number;
  explanationJa: string;
  explanationEn: string;
  isCrossGame?: boolean;
  aerialAdvantage?: number;
} {
  let adv = 0;
  let reasonJa = '戦術バランスは互角です。互いに陣形を保ちながら隙を窺っています。';
  let reasonEn = 'Tactical balance is neutral. Both managers are feeling each other out.';
  let isCross = false;
  let aerialAdv = 0;

  const uAtk = userTac.attackTactic;
  const oDef = oppTac.defenseTactic;
  const uDef = userTac.defenseTactic;
  const oAtk = oppTac.attackTactic;

  const userPlayers = userSquad?.players || [];
  const oppPlayers = oppSquad?.players || [];

  // ── 1. CROSS GAME (クロスゲー) & HEIGHT / AERIAL EVALUATION ──
  if (uAtk === 'CROSS_GAME') {
    isCross = true;
    
    // Find target strikers
    const targetStrikers = userPlayers.filter((p) =>
      ['FW', 'ST', 'CF'].includes(p.subPosition || p.position)
    );
    const bestTarget = targetStrikers.sort((a, b) => {
      const hA = getPlayerHeight(a);
      const hB = getPlayerHeight(b);
      const phyA = a.stats?.physical || a.rating;
      const phyB = b.stats?.physical || b.rating;
      return hB * 0.6 + phyB * 0.4 - (hA * 0.6 + phyA * 0.4);
    })[0];

    const targetHeight = bestTarget ? getPlayerHeight(bestTarget) : 182;
    const targetPhysical = bestTarget?.stats?.physical || bestTarget?.rating || 82;

    // Find crossers (Wingers, Fullbacks, Side Midfielders)
    const crossers = userPlayers.filter((p) =>
      ['LWG', 'RWG', 'LMF', 'RMF', 'LB', 'RB', 'LWB', 'RWB', 'LM', 'RM', 'LW', 'RW'].includes(
        p.subPosition || p.position
      )
    );
    const bestCrosser = crossers.sort(
      (a, b) => (b.stats?.passing || b.rating) - (a.stats?.passing || a.rating)
    )[0];
    const crossQuality = bestCrosser?.stats?.passing || bestCrosser?.rating || 80;

    // Find opponent Center Backs for aerial contest
    const oppCBs = oppPlayers.filter((p) =>
      ['CB', 'DF'].includes(p.subPosition || p.position)
    );
    const oppAvgCBHeight = oppCBs.length
      ? Math.round(oppCBs.reduce((s, p) => s + getPlayerHeight(p), 0) / oppCBs.length)
      : 185;
    const oppAvgCBPhysical = oppCBs.length
      ? Math.round(oppCBs.reduce((s, p) => s + (p.stats?.physical || p.rating), 0) / oppCBs.length)
      : 82;

    // Aerial height difference advantage
    const heightDiff = targetHeight - oppAvgCBHeight; // e.g. 202 - 185 = +17cm
    const physicalDiff = targetPhysical - oppAvgCBPhysical;

    aerialAdv = heightDiff * 0.015 + physicalDiff * 0.008 + (crossQuality >= 85 ? 0.12 : 0.04);

    if (oDef === 'CENTRAL_CONTAIN') {
      adv += 0.45 + aerialAdv;
      reasonJa = targetHeight >= 195
        ? `相手の中央封鎖を完璧に回避！ 身長${targetHeight}cmの${bestTarget?.nameJa || '巨漢FW'}が圧倒的空中戦でゴール前を完全制圧！`
        : '相手の中央密集の死角を突き、サイドからの高精度クロス連打で相手ゴール前を圧倒！';
      reasonEn = `Cross Game exploits central contain! Aerial threat by ${bestTarget?.nameEn || 'FW'} (${targetHeight}cm) dominates the box!`;
    } else if (oDef === 'WIDE_CONTAIN') {
      adv -= 0.28;
      reasonJa = '相手のサイド封鎖守備がクロスの供給源を徹底マークし、クロス攻撃を厳しく遮断。';
      reasonEn = 'Opponent wide contain effectively suffocates the flank crosses.';
    } else if (oDef === 'HIGH_PRESS' || oDef === 'GEGENPRESSING' || oDef === 'FRONT_PRESS') {
      adv += 0.3 + aerialAdv;
      reasonJa = `相手の前線プレスをロングサイドチェンジで一気に無力化！ ${bestTarget?.nameJa || 'ターゲットマン'}（身長${targetHeight}cm）のハイタワーヘッド炸裂！`;
      reasonEn = 'Press-breaking long balls to wide channels unlock devastating aerial deliveries!';
    } else if (oDef === 'LOW_BLOCK' || oDef === 'ZONE_DEFENSE') {
      adv += 0.25 + aerialAdv;
      reasonJa = `相手の密集ローブロック守備の上空から、${bestTarget?.nameJa || 'ターゲットマン'}が圧倒的な高さ（${targetHeight}cm）で競り勝つ！`;
      reasonEn = `Target man aerial supremacy (${targetHeight}cm) crushes opponent low defensive block!`;
    } else {
      adv += 0.22 + aerialAdv;
      reasonJa = `サイドからの高速クロスが中央の${bestTarget?.nameJa || 'ストライカー'}（${targetHeight}cm）を捉え、決定機を量産！`;
      reasonEn = `Fast driven crosses find target forward (${targetHeight}cm) consistently.`;
    }
  }
  // ── 2. OTHER ATTACK TACTICAL MATCHUPS ──
  else if ((uAtk === 'COUNTER' || uAtk === 'LONG_COUNTER' || uAtk === 'QUICK_ATTACK') && (oDef === 'HIGH_PRESS' || oDef === 'GEGENPRESSING' || oDef === 'FRONT_PRESS')) {
    adv += 0.42;
    reasonJa = '相手の前線プレスの背後広大なスペースへ、電光石火のカウンターが完全に突き刺さる！';
    reasonEn = 'Lightning fast counter attack exploits the vacant space behind opponent aggressive press!';
  } else if (uAtk === 'TIKI_TAKA' && (oDef === 'MID_BLOCK' || oDef === 'ZONE_DEFENSE')) {
    adv += 0.40;
    reasonJa = '超高密度なワンタッチパスの連続（ティキ・タカ）が相手のゾーンブロックを完全に崩壊させる！';
    reasonEn = 'Hypnotic one-touch Tiki-Taka combinations slice right through the opponent defensive block!';
  } else if (uAtk === 'TIKI_TAKA' && (oDef === 'SWARM_DEFENSE' || oDef === 'HIGH_PRESS')) {
    adv -= 0.28;
    reasonJa = '相手の群がるような包囲ディフェンス（スウォーム守備）にパスの出しどころを塞がれる。';
    reasonEn = 'Opponent aggressive swarm defense crowds the passing lanes against Tiki-Taka.';
  } else if (uAtk === 'FALSE_NINE' && (oDef === 'MAN_MARK' || oDef === 'CENTRAL_CONTAIN')) {
    adv += 0.42;
    reasonJa = '偽9番（ゼロトップ）が中盤へ下りて相手センターバックを釣り出し、空いたバイタルエリアを完全制圧！';
    reasonEn = 'False Nine drops deep, disorienting opponent markers and completely dominating the vacant hole!';
  } else if (uAtk === 'DIRECT_PLAY' && oDef === 'OFFSIDE_TRAP') {
    adv -= 0.32;
    reasonJa = '相手の高い最終ラインと統率されたオフサイドトラップにダイレクトパスが次々と引っかかる。';
    reasonEn = 'Opponent disciplined offside trap repeatedly catches direct forward passes.';
  } else if (uAtk === 'DIRECT_PLAY' && (oDef === 'RETREAT' || oDef === 'LOW_BLOCK')) {
    adv += 0.28;
    reasonJa = '手数をかけないダイレクトプレーが相手のブロック完成前にゴール前を強襲！';
    reasonEn = 'Rapid direct vertical play breaches opponent territory before the low block consolidates!';
  } else if (uAtk === 'OVERLOAD' && (oDef === 'MAN_MARK' || oDef === 'MID_BLOCK')) {
    adv += 0.36;
    reasonJa = '片サイドへの集中的な数的過負荷（オーバーロード）で相手のマンマーク網を局所崩壊させる！';
    reasonEn = 'Flank overload creates overwhelming numerical superiority, dismantling opponent marking structure!';
  } else if (uAtk === 'THROUGH_PASS' && (oDef === 'HIGH_PRESS' || oDef === 'FRONT_PRESS')) {
    adv += 0.38;
    reasonJa = '前がかりな相手守備ラインの裏へ鋭いスルーパスが通り、決定的一対一を演出！';
    reasonEn = 'Incisive through balls split the opponent high line cleanly.';
  } else if (uAtk === 'THROUGH_PASS' && oDef === 'OFFSIDE_TRAP') {
    adv -= 0.35;
    reasonJa = '相手の一斉に押し上げるオフサイドトラップに裏へのスルーパスを完全に無効化される。';
    reasonEn = 'Opponent offside trap catches the through-ball runners offside consistently.';
  } else if ((uAtk === 'POSSESSION' || uAtk === 'BUILD_UP' || uAtk === 'SHORT_PASS') && (oDef === 'LOW_BLOCK' || oDef === 'CATENACCIO')) {
    adv -= 0.28;
    reasonJa = '相手の強固なカテナチオ・ローブロックにパス回しを外へ追いやられ、決定打を欠く展開。';
    reasonEn = 'Opponent fortress-like Catenaccio/low block frustrates possession rhythm.';
  } else if ((uAtk === 'POSSESSION' || uAtk === 'BUILD_UP') && oDef === 'MID_BLOCK') {
    adv += 0.22;
    reasonJa = '落ち着いたポゼッションとパスワークで中盤の主導権を確実に支配。';
    reasonEn = 'Controlled possession maintains dominance through the midfield.';
  } else if ((uAtk === 'WIDE_ATTACK' || uAtk === 'WIDE_SPREAD') && (oDef === 'CENTRAL_CONTAIN' || oDef === 'BOX_CONTAIN')) {
    adv += 0.35;
    reasonJa = '中央とペナルティエリアを固める相手に対してワイドにピッチを広く使い、サイドアタックを展開！';
    reasonEn = 'Wide attack takes full advantage of opponent central narrowness.';
  } else if (uAtk === 'CENTRAL_ATTACK' && (oDef === 'CATENACCIO' || oDef === 'BOX_CONTAIN')) {
    adv -= 0.30;
    reasonJa = 'カテナチオとPA封鎖の堅牢な中央要塞に中央突破をことごとく阻まれる。';
    reasonEn = 'Central penetration is completely neutralized by opponent impenetrable Catenaccio.';
  } else if (uAtk === 'CENTRAL_ATTACK' && oDef === 'WIDE_CONTAIN') {
    adv += 0.32;
    reasonJa = 'サイド警戒の相手の隙を突き、中央コンビネーションで中央突破に成功！';
    reasonEn = 'Central penetration breaks through opponent wide defensive shape.';
  } else if (uAtk === 'LONG_BALL' && (oDef === 'HIGH_PRESS' || oDef === 'GEGENPRESSING')) {
    adv += 0.3;
    reasonJa = 'ロングボールで相手のハイプレスを一気に無力化し、前線へ素早く展開！';
    reasonEn = 'Long ball bypasses opponent high pressing lines completely.';
  } else if (uAtk === 'HIGH_SPEED_ATTACK' && oDef === 'RETREAT') {
    adv -= 0.2;
    reasonJa = '相手のリトリート守備陣形に速攻の勢いを吸収される。';
    reasonEn = 'Opponent disciplined retreat absorbs early speed.';
  }

  // ── 3. DEFENSE TACTICAL COUNTER EVALUATION ──
  if ((uDef === 'HIGH_PRESS' || uDef === 'GEGENPRESSING') && (oAtk === 'BUILD_UP' || oAtk === 'SHORT_PASS' || oAtk === 'POSSESSION')) {
    adv += 0.3;
    reasonJa += ' また、こちらの激しいゲーゲンプレスが相手の組み立てをことごとく寸断！';
    reasonEn += ' Furthermore, high pressing suffocates opponent short build-up.';
  } else if (uDef === 'SWARM_DEFENSE' && (oAtk === 'TIKI_TAKA' || oAtk === 'SHORT_PASS')) {
    adv += 0.34;
    reasonJa += ' さらにスウォーム守備でボールホルダーを複数人で瞬時に包囲し自由を剥奪！';
    reasonEn += ' Furthermore, swarm defense envelops the ball handler instantly.';
  } else if (uDef === 'OFFSIDE_TRAP' && (oAtk === 'THROUGH_PASS' || oAtk === 'DIRECT_PLAY')) {
    adv += 0.36;
    reasonJa += ' 完璧なタイミングのオフサイドトラップで相手の裏抜けの試みを一網打尽！';
    reasonEn += ' Synchronized offside trap completely neutralizes opponent through runs.';
  } else if (uDef === 'CATENACCIO' && (oAtk === 'CENTRAL_ATTACK' || oAtk === 'QUICK_ATTACK')) {
    adv += 0.38;
    reasonJa += ' 堅牢無比なカテナチオの施錠守備が相手の決定機をことごとく跳ね返す！';
    reasonEn += ' Impenetrable Catenaccio locks down the defensive third with absolute discipline.';
  } else if (uDef === 'BOX_CONTAIN' && (oAtk === 'SHORT_PASS' || oAtk === 'CENTRAL_ATTACK')) {
    adv += 0.32;
    reasonJa += ' ペナルティエリア封鎖の分厚い壁が相手のボックス内侵入をシャットアウト！';
    reasonEn += ' Rigid box containment walls off all entry passes into the penalty area.';
  } else if (uDef === 'COUNTER_PREVENT' && (oAtk === 'COUNTER' || oAtk === 'LONG_COUNTER' || oAtk === 'QUICK_ATTACK')) {
    adv += 0.32;
    reasonJa += ' さらにカウンター対策の守備配置が相手の速攻を未然に遮断！';
    reasonEn += ' Furthermore, counter-prevention structure completely stifles opponent breaks.';
  } else if (uDef === 'MAN_MARK' && (oAtk === 'CENTRAL_ATTACK' || oAtk === 'SHORT_PASS')) {
    adv += 0.26;
    reasonJa += ' 密着マンマークが相手キーマンの自由を完全に奪っています！';
    reasonEn += ' Strict man-marking eliminates opponent playmaker time on the ball.';
  } else if (uDef === 'WIDE_CONTAIN' && (oAtk === 'CROSS_GAME' || oAtk === 'WIDE_ATTACK')) {
    adv += 0.3;
    reasonJa += ' サイド封鎖の守備陣形が相手のクロスとサイドアタックを的確にブロック！';
    reasonEn += ' Wide containment walls off opponent flanking crosses.';
  }

  return {
    userAdvantage: adv,
    explanationJa: reasonJa,
    explanationEn: reasonEn,
    isCrossGame: isCross,
    aerialAdvantage: aerialAdv,
  };
}

/**
 * Calculate win, draw, loss probabilities based on OVR gap.
 * Guarantees:
 * 1. "OVRが高いチーム＝必ず勝つ" is strictly forbidden (upset rate always exists).
 * 2. Probabilities scale smoothly with OVR difference.
 * 3. Even with a large gap, the underdog has a fighting chance (e.g. 5% win, 10% draw).
 */
export function calculateOVRMatchOdds(
  cOvr: number,
  oOvr: number
): {
  winProb: number;
  drawProb: number;
  lossProb: number;
  winPct: number;
  drawPct: number;
  lossPct: number;
} {
  if (cOvr >= 5000 && oOvr < 5000) {
  return {
    winProb: 1,
    drawProb: 0,
    lossProb: 0,
    winPct: 100,
    drawPct: 0,
    lossPct: 0,
  };
}

if (oOvr >= 5000 && cOvr < 5000) {
  return {
    winProb: 0,
    drawProb: 0,
    lossProb: 1,
    winPct: 0,
    drawPct: 0,
    lossPct: 100,
  };
}
  const diff = cOvr - oOvr; // Positive means challenger has higher OVR

  // Base draw probability around 20%-25%, slightly reduced when gap is massive
  const drawPct = Math.max(10, Math.min(24, Math.round(22 - Math.abs(diff) * 1.2)));
  const remaining = 100 - drawPct;

  // Logistic win share: diff = 0 -> 50% of remaining (approx 39% win, 22% draw, 39% loss)
  // diff = +5 -> win share ~73% -> approx 57% win, 21% draw, 22% loss
  // diff = +10 -> win share ~88% -> approx 75% win, 14% draw, 11% loss
  const winShare = 1 / (1 + Math.exp(-diff * 0.22));
  let winPct = Math.round(remaining * winShare);
  let lossPct = remaining - winPct;

  // Underdog protection: even with a massive gap (+15), underdog always has at least 5% win chance and 10% draw chance
  if (winPct < 5) {
    winPct = 5;
    lossPct = remaining - 5;
  } else if (winPct > remaining - 5) {
    winPct = remaining - 5;
    lossPct = 5;
  }

  return {
    winProb: winPct / 100,
    drawProb: drawPct / 100,
    lossProb: lossPct / 100,
    winPct,
    drawPct,
    lossPct,
  };
}

/**
 * Realistic Goal Scorer Picker
 * Fixes bug where DF/GK score too frequently.
 * FW/ST: ~55%
 * Winger/SS: ~28%
 * CAM/AMF: ~12%
 * CM/Midfield: ~4%
 * CB/DF: ~1% (rare header from set piece)
 * GK: 0% (Goalkeepers never score in open play)
 */
export function pickRealisticGoalScorer(players: Player[]): { player: Player; isHeader?: boolean } | null {
  if (!players || players.length === 0) return null;

  // Filter out Goalkeepers completely
  const outfield = players.filter((p) => {
    const pos = (p.subPosition || p.position || '').toUpperCase();
    return pos !== 'GK';
  });

  if (outfield.length === 0) return { player: players[0] };

  const weighted = outfield.map((p) => {
    const pos = (p.subPosition || p.position || '').toUpperCase();
    let baseWeight = 4;
    let isHeaderPossible = false;

    if (['CF', 'ST'].includes(pos)) {
      baseWeight = 55;
      isHeaderPossible = true;
    } else if (['LWG', 'RWG', 'LW', 'RW', 'SS', 'FW'].includes(pos)) {
      baseWeight = 28;
    } else if (['CAM', 'AMF'].includes(pos)) {
      baseWeight = 12;
    } else if (['CM', 'CMF', 'LM', 'RM', 'LMF', 'RMF'].includes(pos)) {
      baseWeight = 5;
    } else if (['CDM', 'DMF', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) {
      baseWeight = 2;
    } else if (['CB', 'DF'].includes(pos)) {
      baseWeight = 0.8; // Only 0.8% chance of a defender set piece goal
      isHeaderPossible = true;
    }

    const shootingFactor = (p.stats?.shooting || p.rating || 80) / 80;
    return {
      player: p,
      weight: baseWeight * shootingFactor,
      isHeader: isHeaderPossible && Math.random() < 0.45,
    };
  });

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const item of weighted) {
    if (roll <= item.weight) {
      return { player: item.player, isHeader: item.isHeader };
    }
    roll -= item.weight;
  }

  return { player: weighted[0]?.player || outfield[0] };
}

/**
 * SIMULATE OVR MATCH (Win-rate based on OVR gap with odds & realistic scoring)
 * Rule: Higher OVR has higher win probability, but upset is always possible ("OVRが高い＝必ず勝つ" is forbidden).
 */
export function simulateOVRMatch(
  challenger: BetaUserProfile,
  opponent: BetaUserProfile,
  challengerPlayingSquad?: UserTeam,
  matchCategory?: 'REALTIME' | 'ASYNC'
): {
  record: BetaMatchRecord;
  events: BetaMatchEvent[];
  odds: {
    winProb: number;
    drawProb: number;
    lossProb: number;
    winPct: number;
    drawPct: number;
    lossPct: number;
  };
} {
  const activeChallengerTeam =
    challengerPlayingSquad || challenger.ovrDefenseSquad || challenger.team;
  const activeOpponentTeam = opponent.ovrDefenseSquad || opponent.team;

  const challengerPlayers = activeChallengerTeam?.players || [];
  const opponentPlayers = activeOpponentTeam?.players || [];

  const cOvr = getPvPSimulationOvr(activeChallengerTeam);
const oOvr = getPvPSimulationOvr(activeOpponentTeam);
  const cPublicOvr = getTeamEffectiveOvr(activeChallengerTeam);
const oPublicOvr = getTeamEffectiveOvr(activeOpponentTeam);

  const diff = cOvr - oOvr;
  const odds = calculateOVRMatchOdds(cOvr, oOvr);

  const roll = Math.random();
  let cScore = 0;
  let oScore = 0;

  if (roll < odds.winProb) {
    // Challenger Win
    if (diff >= 6) {
      cScore = 2 + Math.floor(Math.random() * 2); // 2 or 3
      oScore = Math.random() < 0.4 ? 1 : 0;
    } else {
      cScore = 1 + (Math.random() < 0.5 ? 1 : 0); // 1 or 2
      oScore = cScore - 1;
    }
  } else if (roll < odds.winProb + odds.drawProb) {
    // Draw
    const drawScores = [0, 1, 1, 2];
    const s = drawScores[Math.floor(Math.random() * drawScores.length)];
    cScore = s;
    oScore = s;
  } else {
    // Opponent Win (Upset or expected if opponent has higher OVR)
    if (diff <= -6) {
      oScore = 2 + Math.floor(Math.random() * 2);
      cScore = Math.random() < 0.4 ? 1 : 0;
    } else {
      oScore = 1 + (Math.random() < 0.5 ? 1 : 0);
      cScore = oScore - 1;
    }
  }

  const events: BetaMatchEvent[] = [
    {
      minute: 1,
      type: 'whistle',
      textJa: `主審のホイッスルでOVR総合値マッチがキックオフ！ (OVR ${cPublicOvr} ${challenger.username} vs OVR ${oPublicOvr} ${opponent.username} · 勝率予想: ${odds.winPct}% / 引分: ${odds.drawPct}% / 敗率: ${odds.lossPct}%)`,
textEn: `Kickoff! OVR Match begins (OVR ${cPublicOvr} vs OVR ${oPublicOvr} · Win Odds: ${odds.winPct}%)`,
textEs: `¡Comienza el Partido de OVR! (OVR ${cPublicOvr} vs OVR ${oPublicOvr})`,
    },
    {
      minute: 16,
      type: 'chance',
            textJa: diff > 2
        ? `高いチーム総合値(OVR ${cPublicOvr} · 予想勝率${odds.winPct}%)を誇る${challenger.username}が前線から主導権を掌握！`
        : diff < -2
        ? `圧倒的総合値(OVR ${oPublicOvr} · 相手予想勝率${odds.lossPct}%)の${opponent.username}が猛攻を仕掛ける！`
        : `互角の総合値対決(OVR ${cPublicOvr} vs ${oPublicOvr})！ 予想勝率${odds.winPct}%対${odds.lossPct}%で白熱の一進一退！`,
      textEn: 'Early pressure unfolds on the pitch as both squads test each other.',
      textEs: 'Presión intensa en los primeros minutos de juego.',
    },
  ];

  // Distribute challenger goals to realistic scorers (FW/MF)
  for (let g = 0; g < cScore; g++) {
    const scorerData = pickRealisticGoalScorer(challengerPlayers);
    const scorer = scorerData?.player;
    const scorerName = scorer?.nameJa || challenger.username;
    const scorerRole = scorer?.subPosition || scorer?.position || 'FW';
    const min = g === 0 ? 32 : g === 1 ? 68 : 84;

    events.push({
      minute: min,
      type: 'goal',
      isChallengerGoal: true,
      textJa: scorerData?.isHeader
        ? `⚽ GOOOAL!! ${challenger.username}の${scorerRole} ${scorerName}が高精度クロスに頭で完璧に合わせてゴール！`
        : `⚽ GOOOAL!! ${challenger.username}の${scorerRole} ${scorerName}が鮮烈なシュートを突き刺す！`,
      textEn: `⚽ GOAL!! ${scorerName} (${scorerRole}) scores for ${challenger.username}!`,
      textEs: `⚽ ¡¡GOLAZO!! ¡${scorerName} anota para ${challenger.username}!`,
    });
  }

  // Distribute opponent goals to realistic scorers (FW/MF)
  for (let g = 0; g < oScore; g++) {
    const oppScorerData = pickRealisticGoalScorer(opponentPlayers);
    const oppScorer = oppScorerData?.player;
    const oppScorerName = oppScorer?.nameJa || opponent.username;
    const oppScorerRole = oppScorer?.subPosition || oppScorer?.position || 'FW';
    const min = g === 0 ? 44 : g === 1 ? 75 : 88;

    events.push({
      minute: min,
      type: 'goal',
      isOpponentGoal: true,
      textJa: oppScorerData?.isHeader
        ? `⚽ GOAL! ${opponent.username}の${oppScorerRole} ${oppScorerName}が打点の高いヘディングでネットを揺らす！`
        : `⚽ GOAL! ${opponent.username}の${oppScorerRole} ${oppScorerName}がゴールネットを揺らす！`,
      textEn: `⚽ GOAL! ${oppScorerName} (${oppScorerRole}) scores for ${opponent.username}!`,
      textEs: `⚽ ¡GOL! ¡${oppScorerName} anota para ${opponent.username}!`,
    });
  }

  // Sort events chronologically by minute
  events.sort((a, b) => a.minute - b.minute);

  events.push({
    minute: 90,
    type: 'whistle',
    textJa: `試合終了！ 総合値マッチ結果: ${cScore} - ${oScore} (OVR ${cPublicOvr} vs ${oPublicOvr})`,
    textEn: `Full Time! Final Score: ${cScore} - ${oScore}`,
    textEs: `¡Final del partido! Marcador: ${cScore} - ${oScore}`,
  });

  const result: 'WIN' | 'DRAW' | 'LOSS' =
    cScore > oScore ? 'WIN' : cScore === oScore ? 'DRAW' : 'LOSS';
  const points: 3 | 1 | 0 = result === 'WIN' ? 3 : result === 'DRAW' ? 1 : 0;
  const currentSeason = getSeasonNumberForTimestamp(Date.now());

  const record: BetaMatchRecord = {
    id: 'match_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    challengerUserId: challenger.userId,
    challengerUsername: challenger.username || 'You',
    opponentUserId: opponent.userId,
    opponentUsername: opponent.username,
    matchType: 'OVR',
    matchCategory: matchCategory || (opponent.isOnline ? 'REALTIME' : 'ASYNC'),
    season: currentSeason,
    challengerScore: cScore,
    opponentScore: oScore,
    result,
    points,
    challengerOvr: cPublicOvr,
opponentOvr: oPublicOvr,
    challengerTeamName: activeChallengerTeam?.name || 'My Best XI',
    opponentTeamName: activeOpponentTeam?.name || 'Opponent Best XI',
    timestamp: Date.now(),
    events,
    fullTimeScore: [cScore, oScore],
    challengerTactics: challenger.tactics,
    opponentTactics: opponent.tactics,
    odds: {
      winPct: odds.winPct,
      drawPct: odds.drawPct,
      lossPct: odds.lossPct,
    },
  };

  return { record, events, odds };
}

/**
 * SIMULATE TACTICAL MATCH HALF (Tactics & Synergy over OVR)
 * Rule: Lower OVR can definitely beat Higher OVR through tactical synergy & counters!
 */
export function simulateTacticalMatchHalf(
  half: 1 | 2,
  challenger: BetaUserProfile,
  opponent: BetaUserProfile,
  currentScore: [number, number],
  activeTactics: TeamTactics,
  challengerPlayingSquad?: UserTeam
): {
  halfScore: [number, number];
  events: BetaMatchEvent[];
  tacticalAdvantage: {
    userAdvantage: number;
    explanationJa: string;
    explanationEn: string;
    isCrossGame?: boolean;
    aerialAdvantage?: number;
  };
} {
  const activeChallengerTeam =
    challengerPlayingSquad || challenger.tacticalDefenseSquad || challenger.team;
  const activeOpponentTeam = opponent.tacticalDefenseSquad || opponent.team;

  const opponentTactics =
    (opponent.tacticalDefenseSquad as any)?.tactics || opponent.tactics;

  const tacticalEval = evaluateTacticalAdvantage(
    activeTactics,
    opponentTactics,
    activeChallengerTeam,
    activeOpponentTeam
  );

  const cPlayers = activeChallengerTeam?.players || [];
  const oPlayers = activeOpponentTeam?.players || [];

  const cOvr = getPvPSimulationOvr(activeChallengerTeam);
const oOvr = getPvPSimulationOvr(activeOpponentTeam);

  // Tactical advantage is the primary driver (+/- 0.60), OVR difference is secondary (0.015)
  const effectiveAdv = tacticalEval.userAdvantage + (cOvr - oOvr) * 0.015;

  let newCScore = currentScore[0];
  let newOScore = currentScore[1];

  const events: BetaMatchEvent[] = [];
  const startMin = half === 1 ? 1 : 46;
  const endMin = half === 1 ? 45 : 90;

  events.push({
    minute: startMin,
    type: 'tactic',
    textJa: `${half === 1 ? '前半' : '後半'}キックオフ！ 戦術 [${activeTactics.attackTactic} × ${activeTactics.defenseTactic}] を展開。`,
    textEn: `${half === 1 ? '1st Half' : '2nd Half'} starts! Deploying [${activeTactics.attackTactic} / ${activeTactics.defenseTactic}].`,
    textEs: `¡Comienza el ${half === 1 ? '1er' : '2do'} tiempo! [${activeTactics.attackTactic} / ${activeTactics.defenseTactic}].`,
  });

  // Tactical encounter minute
  events.push({
    minute: half === 1 ? 20 : 65,
    type: 'tactic',
    textJa: tacticalEval.explanationJa,
    textEn: tacticalEval.explanationEn,
    textEs: tacticalEval.explanationEn,
  });

  // Goal calculation heavily weighted by tactical advantage
  const roll = Math.random();
  const challengerGoalThreshold = 0.5 - effectiveAdv * 0.6; // If adv = +0.5, threshold = 0.2 -> 80% chance
  const opponentGoalThreshold = 0.7 + effectiveAdv * 0.4;

  if (roll > challengerGoalThreshold) {
    newCScore += 1;
    const isCross = tacticalEval.isCrossGame;
    const scorerData = pickRealisticGoalScorer(cPlayers);
    const targetPlayer = scorerData?.player;
    const scorerName = targetPlayer?.nameJa || challenger.username;
    const scorerRole = targetPlayer?.subPosition || targetPlayer?.position || 'FW';
    const scorerHeight = targetPlayer ? getPlayerHeight(targetPlayer) : 185;

    events.push({
      minute: half === 1 ? 36 : 76,
      type: 'goal',
      isChallengerGoal: true,
      textJa: isCross || scorerData?.isHeader
        ? `⚽ GOOOAL!! サイドからの高精度クロスに${scorerRole} ${scorerName}（身長${scorerHeight}cm）が打点の高いヘディングで合わせゴールネットを揺らす！`
        : `⚽ GOAL!! 戦術通りの美しい連係から${scorerRole} ${scorerName}が鮮やかにゴール！`,
      textEn: isCross || scorerData?.isHeader
        ? `⚽ GOAL!! ${scorerName} (${scorerHeight}cm) connects with a towering header!`
        : `⚽ GOAL!! Clinical tactical buildup leads to a fine goal by ${scorerName}!`,
      textEs: `⚽ ¡¡GOLAZO!! ¡Gol de excelente factura táctica!`,
    });
  } else if (roll < (1 - opponentGoalThreshold)) {
    newOScore += 1;
    const oppScorerData = pickRealisticGoalScorer(oPlayers);
    const oppScorer = oppScorerData?.player;
    const oppScorerName = oppScorer?.nameJa || opponent.username;
    const oppScorerRole = oppScorer?.subPosition || oppScorer?.position || 'FW';

    events.push({
      minute: half === 1 ? 40 : 80,
      type: 'goal',
      isOpponentGoal: true,
      textJa: `⚽ GOAL! 相手${oppScorerRole} ${oppScorerName}の鋭い突破から隙を突かれ失点！`,
      textEn: `⚽ GOAL! Opponent ${oppScorerName} capitalizes on a counter!`,
      textEs: `⚽ ¡GOL! ¡El rival aprovecha un error táctico!`,
    });
  }

  events.push({
    minute: endMin,
    type: 'whistle',
    textJa: `${half === 1 ? '前半終了' : '試合終了'}！ スコア: ${newCScore} - ${newOScore}`,
    textEn: `${half === 1 ? 'Half Time' : 'Full Time'}! Score: ${newCScore} - ${newOScore}`,
    textEs: `${half === 1 ? 'Descanso' : 'Final'}! Marcador: ${newCScore} - ${newOScore}`,
  });

  return {
    halfScore: [newCScore, newOScore],
    events,
    tacticalAdvantage: tacticalEval,
  };
}
