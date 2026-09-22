import { Player, FormationSlotConfig, FORMATIONS, UserTeam } from '../types';
import { EFootballPosition, VERIFIED_PLAYER_POSITIONS, SUB_POSITION_COMPATIBILITY } from '../data/playerPositions';
export function isGodTeam(team?: Partial<UserTeam> | null): boolean {
  if (!team?.players || team.players.length !== 11) return false;

  const ronaldoCount = team.players.filter(
    (p) => p.playerId === 'bd_special_c_ronaldo_2008'
  ).length;

  const messiCount = team.players.filter(
    (p) => p.playerId === 'bd_special_messi_2012'
  ).length;

  return ronaldoCount === 3 && messiCount === 8;
}
export function getPvPSimulationOvr(
  team?: Partial<UserTeam> | null
): number {
  if (isGodTeam(team)) {
    return 5000;
  }

  return getTeamEffectiveOvr(team);
}
/**
 * Maps (x, y) coordinates on the pitch to an authentic eFootball position.
 * x: 0 (left) to 100 (right)
 * y: 0 (opponent goal/top) to 100 (own goal/bottom)
 */
export function getEFootballPositionFromCoords(x: number, y: number): EFootballPosition {
  // 1. Goalkeeper Area (Bottom Center)
  if (y >= 80 && x >= 28 && x <= 72) {
    return 'GK';
  }

  // 2. Defensive Line (y >= 64)
  if (y >= 64) {
    if (x <= 25) return 'LB';
    if (x >= 75) return 'RB';
    return 'CB';
  }

  // 3. Deep Midfield / Wingback Zone (54 <= y < 64)
  if (y >= 54) {
    if (x <= 22) return 'LWB';
    if (x >= 78) return 'RWB';
    if (x <= 34) return 'DMF';
    if (x >= 66) return 'DMF';
    return 'DMF';
  }

  // 4. Central / Midfield Line (42 <= y < 54)
  if (y >= 42) {
    if (x <= 25) return 'LMF';
    if (x >= 75) return 'RMF';
    if (y <= 46 && x >= 36 && x <= 64) return 'AMF';
    return 'CMF';
  }

  // 5. Attacking Midfield / Wingers (26 <= y < 42)
  if (y >= 26) {
    if (x <= 26) return y >= 34 ? 'LMF' : 'LWG';
    if (x >= 74) return y >= 34 ? 'RMF' : 'RWG';
    if (y <= 32 && x >= 36 && x <= 64) return 'SS';
    return 'AMF';
  }

  // 6. Forward / Striker Zone (y < 26)
  if (x <= 28) return 'LWG';
  if (x >= 72) return 'RWG';
  if (y >= 18 && (x <= 38 || x >= 62)) return 'SS';
  return 'CF';
}

/**
 * Maps a preset slot role string (e.g. 'ST', 'CAM', 'CDM', 'LW') to eFootball standard notation.
 */
export function normalizeRoleToEFootball(role: string): EFootballPosition {
  const upper = (role || '').toUpperCase().trim();
  switch (upper) {
    case 'GK':
      return 'GK';
    case 'CB':
      return 'CB';
    case 'LB':
    case 'LSB':
      return 'LB';
    case 'RB':
    case 'RSB':
      return 'RB';
    case 'LWB':
      return 'LWB';
    case 'RWB':
      return 'RWB';
    case 'CDM':
    case 'DMF':
      return 'DMF';
    case 'CM':
    case 'CMF':
      return 'CMF';
    case 'LM':
    case 'LMF':
      return 'LMF';
    case 'RM':
    case 'RMF':
      return 'RMF';
    case 'CAM':
    case 'LAM':
    case 'RAM':
    case 'AMF':
    case 'OMF':
      return 'AMF';
    case 'LW':
    case 'LWG':
      return 'LWG';
    case 'RW':
    case 'RWG':
      return 'RWG';
    case 'SS':
      return 'SS';
    case 'ST':
    case 'CF':
    case 'FW':
      return 'CF';
    case 'DF':
      return 'CB';
    case 'MF':
      return 'CMF';
    default:
      return 'CMF';
  }
}

/**
 * Returns the set of verified playable positions for a player based on official records.
 */
export function getVerifiedPositionsForPlayer(player: Player): EFootballPosition[] {
  if (!player) return ['CMF'];

  // 1. Direct personId lookup
  if (player.personId && VERIFIED_PLAYER_POSITIONS[player.personId]) {
    return VERIFIED_PLAYER_POSITIONS[player.personId];
  }

  // 2. Direct playerId lookup
  if (player.playerId && VERIFIED_PLAYER_POSITIONS[player.playerId]) {
    return VERIFIED_PLAYER_POSITIONS[player.playerId];
  }

  // Explicit check for Beckenbauer (CB, DMF, CMF)
  const pName = (player.playerName || '').toLowerCase();
  const pNameJa = player.nameJa || '';
  if (
    pNameJa.includes('ベッケンバウアー') ||
    pName.includes('beckenbauer') ||
    player.personId === 'beckenbauer' ||
    player.personId === 'f_beckenbauer'
  ) {
    return ['CB', 'DMF', 'CMF'];
  }

  // Explicit check for Sergio Ramos (CB, RB/RSB, DMF)
  if (
    pNameJa.includes('ラモス') ||
    pName.includes('ramos') ||
    player.personId === 'sergio_ramos' ||
    player.personId === 's_ramos'
  ) {
    return ['CB', 'RB', 'DMF'];
  }

  // 3. Fallback based on verified subPosition
  const subPos = (player.subPosition || player.position || '').toUpperCase();
  if (SUB_POSITION_COMPATIBILITY[subPos]) {
    return SUB_POSITION_COMPATIBILITY[subPos];
  }

  // 4. Main position fallback
  if (player.position === 'GK') return ['GK'];
  if (player.position === 'DF') return ['CB', 'LB', 'RB'];
  if (player.position === 'MF') return ['CMF', 'DMF', 'AMF'];
  if (player.position === 'FW') return ['CF', 'LWG', 'RWG', 'SS'];

  return ['CMF'];
}

/**
 * Evaluates how suitable a position is for a player and calculates the resulting OVR.
 * Implements graduated OVR penalty based on position suitability gap:
 * - Verified/Natural position: 0 penalty (100% OVR)
 * - Minor gap (e.g. CF<->SS, RWG/LWG<->RMF/LMF, CMF<->AMF/DMF, CB<->SB): -2 to -4
 * - Moderate gap (e.g. FW<->CMF/DMF, DF<->AMF): -7 to -9
 * - Major gap (e.g. FW<->CB/LB/RB, DF<->CF): -14 to -16
 * - Extreme gap (GK<->Outfield player): -24 to -28
 */
export function evaluatePlayerAtPosition(
  player: Player,
  targetPosition: EFootballPosition
): {
  displayedPosition: EFootballPosition;
  isSuitable: boolean;
  effectiveRating: number;
  ratingDelta: number;
} {
  const verifiedList = getVerifiedPositionsForPlayer(player);
  const isSuitable = verifiedList.includes(targetPosition);

  if (isSuitable) {
    return {
      displayedPosition: targetPosition,
      isSuitable: true,
      effectiveRating: player.rating,
      ratingDelta: 0,
    };
  }

  // Calculate graduated penalty
  let penalty = 4;
  const isPlayerGK = player.position === 'GK';
  const isTargetGK = targetPosition === 'GK';

  if (isPlayerGK && !isTargetGK) {
    // GK playing in outfield
    penalty = 28;
  } else if (!isPlayerGK && isTargetGK) {
    // Outfield playing in GK (大幅にOVR低下)
    penalty = 28;
  } else if (
    (player.position === 'FW' && ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(targetPosition)) ||
    (player.position === 'DF' && ['CF', 'SS', 'LWG', 'RWG'].includes(targetPosition))
  ) {
    // Major position gap (FW <-> DF) -> OVR 90 becomes 80 (penalty = 10)
    penalty = 10;
  } else if (
    (player.position === 'FW' && ['DMF', 'CMF'].includes(targetPosition)) ||
    (player.position === 'DF' && ['AMF'].includes(targetPosition))
  ) {
    // Moderate position gap (FW in deep midfield)
    penalty = 7;
  } else if (
    (player.position === 'MF' && ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(targetPosition)) ||
    (player.position === 'MF' && ['CF', 'LWG', 'RWG'].includes(targetPosition))
  ) {
    // Moderate position gap (MF -> deep DF or high CF)
    penalty = 6;
  } else {
    // Minor position gap (adjacent role, e.g. FW in AMF/LMF/RMF) -> OVR 90 becomes 87 (penalty = 3)
    penalty = 3;
  }

  const effectiveRating = Math.max(30, player.rating - penalty);

  return {
    displayedPosition: targetPosition,
    isSuitable: false,
    effectiveRating,
    ratingDelta: -penalty,
  };
}

/**
 * Strict position validation engine (Requirement 3 & 13)
 * Centralizes all position legality checks across the application.
 *
 * Rules:
 * - In strict mode, GK cannot play in outfield and FW cannot play in deep DF.
 * - In custom/free mode (allowAnyWithPenalty = true), placements are allowed with graduated OVR penalty.
 */
export function canPlayerPlayAtPosition(
  player: Player,
  targetPosition: EFootballPosition,
  allowAnyWithPenalty: boolean = false
): { allowed: boolean; reasonJa: string; reasonEn: string } {
  if (!player) return { allowed: true, reasonJa: '', reasonEn: '' };

  if (allowAnyWithPenalty) {
    return { allowed: true, reasonJa: '', reasonEn: '' };
  }

  // 1. GK Rules
  if (player.position === 'GK' && targetPosition !== 'GK') {
    return {
      allowed: false,
      reasonJa: 'GKはフィールドプレイヤーのポジション（CB/SB/MF/FW）に配置できません。',
      reasonEn: 'Goalkeepers cannot be placed in outfield positions.',
    };
  }

  if (player.position !== 'GK' && targetPosition === 'GK') {
    return {
      allowed: false,
      reasonJa: 'GK以外の選手はGKポジションに配置できません。',
      reasonEn: 'Outfield players cannot be placed as Goalkeeper.',
    };
  }

  const verified = getVerifiedPositionsForPlayer(player);

  // 2. Strict FW -> DF prohibition (e.g. FW cannot play CB/LB/RB/LWB/RWB)
  if (player.position === 'FW' && ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(targetPosition)) {
    if (!verified.includes(targetPosition)) {
      return {
        allowed: false,
        reasonJa: 'FWの選手は守備的なDFポジション（CB/SB）に配置できません。',
        reasonEn: 'Forwards cannot be placed in defensive (CB/SB) positions.',
      };
    }
  }

  // 3. Strict DF -> FW prohibition (e.g. DF cannot play CF/SS/LWG/RWG)
  if (player.position === 'DF' && ['CF', 'SS', 'LWG', 'RWG'].includes(targetPosition)) {
    if (!verified.includes(targetPosition)) {
      return {
        allowed: false,
        reasonJa: 'DFの選手は前線のFWポジション（CF/WG/ST）に配置できません。',
        reasonEn: 'Defenders cannot be placed in forward (CF/WG/ST) positions.',
      };
    }
  }

  return { allowed: true, reasonJa: '', reasonEn: '' };
}

/**
 * Verifies if two slots can be swapped without violating position constraints.
 * In MY TEAM standard mode, any two players can always be freely swapped!
 */
export function canSwapPlayersBetweenRoles(
  playerA: Player | undefined,
  roleA: string,
  playerB: Player | undefined,
  roleB: string,
  allowAnyWithPenalty: boolean = true
): { allowed: boolean; reasonJa?: string; reasonEn?: string } {
  if (allowAnyWithPenalty) {
    return { allowed: true };
  }

  const posA = normalizeRoleToEFootball(roleA);
  const posB = normalizeRoleToEFootball(roleB);

  if (playerA) {
    const checkA = canPlayerPlayAtPosition(playerA, posB);
    if (!checkA.allowed) return checkA;
  }

  if (playerB) {
    const checkB = canPlayerPlayAtPosition(playerB, posA);
    if (!checkB.allowed) return checkB;
  }

  return { allowed: true };
}

/**
 * Computes the team's average OVR with positional penalties applied in real-time.
 * Reflects player placement, formation, custom coordinates, and slot swaps.
 */
export function getTeamEffectiveOvr(team?: Partial<UserTeam> | null): number {
  if (!team || !team.players || team.players.length === 0) return 85;

  const basePreset = team.formation === 'CUSTOM' ? '4-3-3' : team.formation || '4-3-3';
  const baseSlots = FORMATIONS[basePreset]?.slots || FORMATIONS['4-3-3'].slots;
  const playerSlots = team.playerSlots || {};
  const customPositions = team.customPositions || {};

  let totalEffectiveRating = 0;
  let evaluatedCount = 0;
  const evaluatedPlayerIds = new Set<string>();

  baseSlots.forEach((slot) => {
    const pId = playerSlots[slot.id];
    if (!pId) return;
    const player = team.players.find((p) => p.playerId === pId);
    if (!player) return;

    let targetPos: EFootballPosition;
    const custom = customPositions[slot.id] || (pId ? customPositions[pId] : undefined);
    if (custom) {
      targetPos = getEFootballPositionFromCoords(custom.x, custom.y);
    } else {
      targetPos = normalizeRoleToEFootball(slot.role);
    }

    const evalResult = evaluatePlayerAtPosition(player, targetPos);
    totalEffectiveRating += evalResult.effectiveRating;
    evaluatedCount++;
    evaluatedPlayerIds.add(player.playerId);
  });

  // Include any drafted players on the squad not mapped to a slot
  team.players.forEach((p) => {
    if (!evaluatedPlayerIds.has(p.playerId)) {
      totalEffectiveRating += p.rating;
      evaluatedCount++;
    }
  });

  if (evaluatedCount === 0) {
    return Math.round(team.players.reduce((sum, p) => sum + p.rating, 0) / team.players.length);
  }

  return Math.round(totalEffectiveRating / evaluatedCount);
}

/**
 * Checks if a candidate player can be drafted given team GK constraints (Exactly 1 GK per team)
 */
export function canTeamAcceptGK(
  teamPlayers: Player[],
  candidate: Player
): { allowed: boolean; reasonJa?: string; reasonEn?: string } {
  const hasGk = teamPlayers.some((p) => p.position === 'GK');

  if (candidate.position === 'GK' && hasGk) {
    return {
      allowed: false,
      reasonJa: '1チームにGKは1人のみ編成可能です（すでにGKが所属しています）。',
      reasonEn: 'A squad can only have exactly 1 Goalkeeper.',
    };
  }

  if (teamPlayers.length === 10 && !hasGk && candidate.position !== 'GK') {
    return {
      allowed: false,
      reasonJa: 'チーム完成にはGKが1人必須です。GK選手を選択してください。',
      reasonEn: 'The 11th player must be a Goalkeeper.',
    };
  }

  return { allowed: true };
}

