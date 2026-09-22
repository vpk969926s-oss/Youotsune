import { Player, RewardTicketType, GiftBoxItem, PastWeeklyRankingHistory, BetaStandingEntry } from '../types';
import { PURPLE_ACTIVE_PLAYERS } from '../data/purpleActivePlayers';
import { EUROPEAN_PLAYERS } from '../data/playersEurope';
import { SPECIAL_BALLON_DOR_PLAYERS } from '../data/legendaryEraDatabase';
import { ALL_PLAYERS } from '../data/playerDatabase';

export type PresentBoxItem = GiftBoxItem;
export type UserRewardTickets = Record<RewardTicketType, number>;
export type ScoutTicketType = RewardTicketType;

export function getTotalTicketsCount(tickets: Record<RewardTicketType, number>): number {
  return Object.values(tickets).reduce((sum, c) => sum + (c || 0), 0);
}

export interface RewardScoutDefinition {
  type: RewardTicketType;
  nameJa: string;
  nameEn: string;
  descriptionJa: string;
  descriptionEn: string;
  candidateCount: number;
  guaranteedType?: 'legend' | 'purple' | 'both';
  legendChance: number; // 0 - 1
  purpleChance: number; // 0 - 1
  badgeColor: string;
  accentGradient: string;
  iconName: string;
}

export const REWARD_SCOUT_DEFINITIONS: Record<RewardTicketType, RewardScoutDefinition> = {
  legend_guaranteed: {
    type: 'legend_guaranteed',
    nameJa: 'レジェンド確定スカウト',
    nameEn: 'Legend Guaranteed Scout',
    descriptionJa: '歴史に名を刻むレジェンド選手のみが5名登場。1名を選択してMY TEAMへ追加可能！',
    descriptionEn: '5 legendary icons appear. Pick 1 to add directly to your MY TEAM!',
    candidateCount: 5,
    guaranteedType: 'legend',
    legendChance: 1.0,
    purpleChance: 0.0,
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    accentGradient: 'from-amber-500/30 via-yellow-600/20 to-amber-900/40',
    iconName: 'Crown',
  },
  purple_guaranteed: {
    type: 'purple_guaranteed',
    nameJa: '紫確定スカウト',
    nameEn: 'Purple Guaranteed Scout',
    descriptionJa: '世界最高峰の現役スーパースター（OVR 98〜101）のみが5名登場。1名を選択してMY TEAMへ！',
    descriptionEn: '5 world-class modern superstars (OVR 98-101) appear. Pick 1 for your MY TEAM!',
    candidateCount: 5,
    guaranteedType: 'purple',
    legendChance: 0.0,
    purpleChance: 1.0,
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    accentGradient: 'from-purple-600/30 via-fuchsia-600/20 to-purple-950/40',
    iconName: 'Sparkles',
  },
  legend_purple_guaranteed: {
    type: 'legend_purple_guaranteed',
    nameJa: 'レジェンド・紫確定スカウト',
    nameEn: 'Legend / Purple Guaranteed Scout',
    descriptionJa: '歴史的レジェンドまたは紫演出現役選手のみが5名登場。究極の候補から1名を選択！',
    descriptionEn: '5 elite candidates (Legends or Purple superstars). Pick 1 to reinforce your squad!',
    candidateCount: 5,
    guaranteedType: 'both',
    legendChance: 0.5,
    purpleChance: 0.5,
    badgeColor: 'bg-gradient-to-r from-amber-500/20 to-purple-500/20 text-yellow-200 border-amber-400/40',
    accentGradient: 'from-amber-600/30 via-purple-700/20 to-stone-900/40',
    iconName: 'Award',
  },
  legend_purple_50: {
    type: 'legend_purple_50',
    nameJa: 'レジェンド・紫50%スカウト',
    nameEn: 'Legend / Purple 50% Scout',
    descriptionJa: '50%の確率でレジェンドまたは紫演出スターが出現！3名の候補から1名を選択。',
    descriptionEn: '50% chance for Legend or Purple superstar staging! Select 1 from 3 candidates.',
    candidateCount: 3,
    legendChance: 0.25,
    purpleChance: 0.25,
    badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    accentGradient: 'from-indigo-600/30 via-purple-600/20 to-slate-900/40',
    iconName: 'Zap',
  },
  legend_50: {
    type: 'legend_50',
    nameJa: 'レジェンド50%スカウト',
    nameEn: 'Legend 50% Scout',
    descriptionJa: '50%の確率でレジェンド選手が出現する高確率スカウト！3名の候補から1名を選択。',
    descriptionEn: '50% chance to trigger a Legendary staging! Choose 1 of 3 candidates.',
    candidateCount: 3,
    legendChance: 0.5,
    purpleChance: 0.0,
    badgeColor: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
    accentGradient: 'from-yellow-600/30 via-amber-700/20 to-stone-900/40',
    iconName: 'Star',
  },
  legend_20: {
    type: 'legend_20',
    nameJa: 'レジェンド20%スカウト',
    nameEn: 'Legend 20% Scout',
    descriptionJa: '20%の確率でレジェンド選手が出現する特別スカウト！全プレイヤーお詫び配布対象。',
    descriptionEn: '20% chance to summon a Legend! All players receive 1 as an apology gift.',
    candidateCount: 3,
    legendChance: 0.2,
    purpleChance: 0.0,
    badgeColor: 'bg-amber-600/20 text-amber-300 border-amber-600/40',
    accentGradient: 'from-amber-700/30 via-stone-800/40 to-stone-900/40',
    iconName: 'Gift',
  },
  purple_50: {
    type: 'purple_50',
    nameJa: '紫50%スカウト',
    nameEn: 'Purple 50% Scout',
    descriptionJa: '50%の確率で紫演出（OVR 98〜101現役スター）が出現！3名の候補から選択。',
    descriptionEn: '50% chance to summon Purple Active Superstars! Pick 1 of 3 candidates.',
    candidateCount: 3,
    legendChance: 0.0,
    purpleChance: 0.5,
    badgeColor: 'bg-purple-600/20 text-purple-300 border-purple-600/40',
    accentGradient: 'from-purple-700/30 via-fuchsia-900/30 to-slate-900/40',
    iconName: 'Flame',
  },
  purple_20: {
    type: 'purple_20',
    nameJa: '紫20%スカウト',
    nameEn: 'Purple 20% Scout',
    descriptionJa: '20%の確率で紫演出（現役スーパースター）が出現！3名の候補から選択。',
    descriptionEn: '20% chance to summon Purple Active Superstars! Pick 1 of 3 candidates.',
    candidateCount: 3,
    legendChance: 0.0,
    purpleChance: 0.2,
    badgeColor: 'bg-fuchsia-600/20 text-fuchsia-300 border-fuchsia-600/40',
    accentGradient: 'from-fuchsia-700/30 via-purple-900/30 to-slate-900/40',
    iconName: 'Sparkle',
  },
};

// Storage Keys
const LOCAL_STORAGE_USER_TICKETS = 'FOOTBALL_DRAFT_USER_TICKETS_V130';
const LOCAL_STORAGE_PRESENT_BOX = 'FOOTBALL_DRAFT_PRESENT_BOX_V130';
const LOCAL_STORAGE_APOLOGY_CLAIMED = 'FOOTBALL_DRAFT_APOLOGY_GIFT_CLAIMED_V130';
const LOCAL_STORAGE_PAST_RANKINGS = 'FOOTBALL_DRAFT_PAST_WEEKLY_RANKINGS_V130';

/**
 * Get all legend candidate pool (distinct person IDs)
 */
export function getAllLegendPool(): Player[] {
  const map = new Map<string, Player>();
  for (const p of SPECIAL_BALLON_DOR_PLAYERS) {
    const pId = p.personId || p.playerId;
    if (!map.has(pId)) map.set(pId, p);
  }
  for (const p of ALL_PLAYERS) {
    if (p.isLegendary || p.category === 'LEGEND') {
      const pId = p.personId || p.playerId;
      if (!map.has(pId)) map.set(pId, p);
    }
  }
  for (const p of EUROPEAN_PLAYERS) {
    if (p.isLegendary) {
      const pId = p.personId || p.playerId;
      if (!map.has(pId)) map.set(pId, p);
    }
  }
  return Array.from(map.values());
}

/**
 * Get all purple candidate pool
 */
export function getAllPurplePool(): Player[] {
  return [...PURPLE_ACTIVE_PLAYERS];
}

/**
 * Generate candidate players for a specific scout type
 * Strictly enforces no duplicate person IDs within the same candidate set!
 */
export function generateScoutCandidates(ticketType: RewardTicketType): {
  candidates: Player[];
  stagingType: 'gold' | 'purple' | 'normal';
} {
  const def = REWARD_SCOUT_DEFINITIONS[ticketType];
  const count = def.candidateCount;
  const rand = Math.random();

  let stagingType: 'gold' | 'purple' | 'normal' = 'normal';
  if (def.guaranteedType === 'legend') {
    stagingType = 'gold';
  } else if (def.guaranteedType === 'purple') {
    stagingType = 'purple';
  } else if (def.guaranteedType === 'both') {
    stagingType = rand < 0.5 ? 'gold' : 'purple';
  } else {
    // Probability based
    if (rand < def.legendChance) {
      stagingType = 'gold';
    } else if (rand < def.legendChance + def.purpleChance) {
      stagingType = 'purple';
    } else {
      stagingType = 'normal';
    }
  }

  const legendPool = getAllLegendPool();
  const purplePool = getAllPurplePool();
  const normalPool = ALL_PLAYERS.filter((p) => !p.isLegendary && p.rating >= 85 && !p.playerId.startsWith('purple_'));

  const selectedCandidates: Player[] = [];
  const selectedPersonIds = new Set<string>();

  function addCandidateFromPool(pool: Player[]): boolean {
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    for (const player of shuffled) {
      const personKey = (player.personId || player.playerName).toLowerCase();
      if (!selectedPersonIds.has(personKey)) {
        selectedPersonIds.add(personKey);
        selectedCandidates.push(player);
        return true;
      }
    }
    return false;
  }

  // Generate candidates based on determined staging
  if (stagingType === 'gold') {
    while (selectedCandidates.length < count) {
      if (!addCandidateFromPool(legendPool)) break;
    }
  } else if (stagingType === 'purple') {
    // Diversify positions: try selecting from GK, DF, MF, FW
    const gk = purplePool.filter((p) => p.position === 'GK');
    const df = purplePool.filter((p) => p.position === 'DF');
    const mf = purplePool.filter((p) => p.position === 'MF');
    const fw = purplePool.filter((p) => p.position === 'FW');

    // Add diverse candidates
    if (count === 3) {
      // Pick 3 from distinct positions
      const pools = [fw, mf, df, gk].sort(() => 0.5 - Math.random());
      for (const p of pools) {
        if (selectedCandidates.length < 3) {
          addCandidateFromPool(p);
        }
      }
    } else {
      // Pick 5
      addCandidateFromPool(fw);
      addCandidateFromPool(mf);
      addCandidateFromPool(df);
      addCandidateFromPool(gk);
    }
    // Fill remaining
    while (selectedCandidates.length < count) {
      if (!addCandidateFromPool(purplePool)) break;
    }
  } else {
    // Normal staging: mix of high rated players
    while (selectedCandidates.length < count) {
      if (!addCandidateFromPool(normalPool)) break;
    }
  }

  return {
    candidates: selectedCandidates,
    stagingType,
  };
}

/**
 * User Ticket Inventory state management
 */
export function getStoredUserTickets(): Record<RewardTicketType, number> {
  const defaultInventory: Record<RewardTicketType, number> = {
    legend_20: 0,
    legend_50: 0,
    legend_guaranteed: 0,
    purple_20: 0,
    purple_50: 0,
    purple_guaranteed: 0,
    legend_purple_guaranteed: 0,
    legend_purple_50: 0,
  };

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_USER_TICKETS);
    if (!raw) return defaultInventory;
    const parsed = JSON.parse(raw);
    return { ...defaultInventory, ...parsed };
  } catch {
    return defaultInventory;
  }
}

export function saveUserTickets(tickets: Record<RewardTicketType, number>): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_USER_TICKETS, JSON.stringify(tickets));
  } catch (e) {
    console.warn('Failed to save user tickets:', e);
  }
}

export function addTicketToUser(type: RewardTicketType, count: number = 1): Record<RewardTicketType, number> {
  const current = getStoredUserTickets();
  const updated = {
    ...current,
    [type]: (current[type] || 0) + count,
  };
  saveUserTickets(updated);
  return updated;
}

export function consumeUserTicket(type: RewardTicketType): boolean {
  const current = getStoredUserTickets();
  if (!current[type] || current[type] <= 0) {
    return false;
  }
  const updated = {
    ...current,
    [type]: current[type] - 1,
  };
  saveUserTickets(updated);
  return true;
}

export const consumeScoutTicket = consumeUserTicket;

/**
 * Present Box state management
 */
export function getStoredPresents(userId: string): GiftBoxItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PRESENT_BOX);
    if (!raw) return [];
    const all: GiftBoxItem[] = JSON.parse(raw);
    return all.filter((item) => item.userId === userId);
  } catch {
    return [];
  }
}

export function saveAllPresents(presents: GiftBoxItem[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_PRESENT_BOX, JSON.stringify(presents));
  } catch (e) {
    console.warn('Failed to save presents:', e);
  }
}

export const APOLOGY_V131_EXPIRES_AT = new Date('2026-09-30T23:59:59+09:00').getTime();

/**
 * Ensure the apology gifts (Legend 20% Scout and 1.3.1 Legend Guaranteed Scout) are distributed to present box
 */
export function ensureApologyGiftDistributed(userId: string): GiftBoxItem[] {
  try {
    const allPresentsRaw = localStorage.getItem(LOCAL_STORAGE_PRESENT_BOX);
    const allPresents: GiftBoxItem[] = allPresentsRaw ? JSON.parse(allPresentsRaw) : [];
    let updated = false;
    
    // 1. Check if 1.3.0 apology gift already exists for this user
    const apologyId = `apology_gift_${userId}_legend20`;
    const exists = allPresents.some((p) => p.id === apologyId || (p.userId === userId && p.rewardType === 'legend_20' && p.title.includes('お詫び')));
    
    if (!exists) {
      const apologyGift: GiftBoxItem = {
        id: apologyId,
        userId,
        title: '【運営からのお詫び】特別スカウト配布',
        description: 'アップデートに伴うお詫びとして「レジェンド20%スカウト ×1」をお送りいたします。',
        rewardType: 'legend_20',
        amount: 1,
        isClaimed: false,
        createdAt: Date.now(),
      };
      allPresents.unshift(apologyGift);
      updated = true;
    }

    // 2. Check if 1.3.1 Legend Guaranteed apology gift exists for this user
    const apologyV131Id = `apology_v131_legend_guaranteed_${userId}`;
    const existsV131 = allPresents.some((p) => p.id === apologyV131Id);

    if (!existsV131) {
      const apologyV131Gift: GiftBoxItem = {
        id: apologyV131Id,
        userId,
        title: '【1.3.1修正お詫び】レジェンド確定スカウト',
        description: '1.3.1修正アップデートのお詫びとして「レジェンド確定スカウト ×1」をお送りいたします。（有効期限: 2026年9月30日 23:59 JSTまで）',
        rewardType: 'legend_guaranteed',
        amount: 1,
        isClaimed: false,
        createdAt: Date.now(),
        expiresAt: APOLOGY_V131_EXPIRES_AT,
      };
      allPresents.unshift(apologyV131Gift);
      updated = true;
    }
        // Youotsune限定配布：レジェンド確定 ×10
    const youotsuneLegendId = `youotsune_launch_legend10_${userId}`;
    if (!allPresents.some((p) => p.id === youotsuneLegendId)) {
      allPresents.unshift({
        id: youotsuneLegendId,
        userId,
        title: '【Youotsune記念配布】レジェンド確定スカウト ×10',
        description: 'Youotsune限定で「レジェンド確定スカウト ×10」を配布します。',
        rewardType: 'legend_guaranteed',
        amount: 10,
        isClaimed: false,
        createdAt: Date.now(),
      });
      updated = true;
    }

    // Youotsune限定配布：紫確定 ×10
    const youotsunePurpleId = `youotsune_launch_purple10_${userId}`;
    if (!allPresents.some((p) => p.id === youotsunePurpleId)) {
      allPresents.unshift({
        id: youotsunePurpleId,
        userId,
        title: '【Youotsune記念配布】紫確定スカウト ×10',
        description: 'Youotsune限定で「紫確定スカウト ×10」を配布します。',
        rewardType: 'purple_guaranteed',
        amount: 10,
        isClaimed: false,
        createdAt: Date.now(),
      });
      updated = true;
    }
    if (updated) {
      saveAllPresents(allPresents);
    }
    
    return allPresents.filter((item) => item.userId === userId);
  } catch (e) {
    console.warn('Error checking apology gift:', e);
    return [];
  }
}

/**
 * Claim a gift from the present box
 * Returns updated list of presents
 */
export function claimPresentBoxItem(presentId: string, userId: string): {
  success: boolean;
  claimedItem?: GiftBoxItem;
  updatedPresents: GiftBoxItem[];
  updatedTickets: Record<RewardTicketType, number>;
} {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PRESENT_BOX);
    const allPresents: GiftBoxItem[] = raw ? JSON.parse(raw) : [];
    const target = allPresents.find((p) => p.id === presentId && p.userId === userId);

    if (!target || target.isClaimed) {
      return {
        success: false,
        updatedPresents: allPresents.filter((p) => p.userId === userId),
        updatedTickets: getStoredUserTickets(),
      };
    }

    // Check expiration
    if (target.expiresAt && Date.now() > target.expiresAt) {
      console.warn('Item is expired and cannot be claimed:', target.id);
      return {
        success: false,
        updatedPresents: allPresents.filter((p) => p.userId === userId),
        updatedTickets: getStoredUserTickets(),
      };
    }

    // Mark claimed
    target.isClaimed = true;
    target.claimedAt = Date.now();
    saveAllPresents(allPresents);

    // Safely add ticket
    const updatedTickets = addTicketToUser(target.rewardType, target.amount || 1);

    return {
      success: true,
      claimedItem: target,
      updatedPresents: allPresents.filter((p) => p.userId === userId),
      updatedTickets,
    };
  } catch (e) {
    console.warn('Error claiming present:', e);
    return {
      success: false,
      updatedPresents: getStoredPresents(userId),
      updatedTickets: getStoredUserTickets(),
    };
  }
}

/**
 * Claim all unclaimed gifts in the present box at once
 */
export function claimAllPresentBoxItems(userId: string): {
  success: boolean;
  claimedCount: number;
  updatedPresents: GiftBoxItem[];
  updatedTickets: Record<RewardTicketType, number>;
} {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PRESENT_BOX);
    const allPresents: GiftBoxItem[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    let claimedCount = 0;

    for (const item of allPresents) {
      if (item.userId === userId && !item.isClaimed) {
        // Skip expired
        if (item.expiresAt && now > item.expiresAt) {
          continue;
        }
        item.isClaimed = true;
        item.claimedAt = now;
        addTicketToUser(item.rewardType, item.amount || 1);
        claimedCount++;
      }
    }

    if (claimedCount > 0) {
      saveAllPresents(allPresents);
    }

    return {
      success: true,
      claimedCount,
      updatedPresents: allPresents.filter((p) => p.userId === userId),
      updatedTickets: getStoredUserTickets(),
    };
  } catch (e) {
    console.warn('Error claiming all presents:', e);
    return {
      success: false,
      claimedCount: 0,
      updatedPresents: getStoredPresents(userId),
      updatedTickets: getStoredUserTickets(),
    };
  }
}

/**
 * Past Weekly Rankings History
 */
export function getStoredPastRankings(): PastWeeklyRankingHistory[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PAST_RANKINGS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePastRankings(history: PastWeeklyRankingHistory[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_PAST_RANKINGS, JSON.stringify(history));
  } catch (e) {
    console.warn('Failed to save past rankings:', e);
  }
}

const LOCAL_STORAGE_DISTRIBUTED_WEEKS = 'FOOTBALL_DRAFT_DISTRIBUTED_WEEKS_V130';

export function getDistributedWeeks(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_DISTRIBUTED_WEEKS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function markWeekAsDistributed(weekId: string): void {
  try {
    const list = getDistributedWeeks();
    if (!list.includes(weekId)) {
      list.push(weekId);
      localStorage.setItem(LOCAL_STORAGE_DISTRIBUTED_WEEKS, JSON.stringify(list));
    }
  } catch (e) {
    console.warn('Failed to mark week as distributed:', e);
  }
}

/**
 * Server/Client Authoritative Weekly Ranking Reward Distribution
 * Rules:
 * - 1st place: Legend Guaranteed Scout x1
 * - 2nd place: Purple Guaranteed Scout x1
 * - 3rd place: Legend / Purple 50% Scout x1
 * - Strictly 1 recipient per rank tier (no duplicates, no 4th+)
 * - Strictly no double-distribution for the same week_id
 */
export function distributeWeeklyRewardsForWeek(
  weekId: string,
  seasonNum: number,
  standings: BetaStandingEntry[]
): {
  success: boolean;
  distributed: boolean;
  recipients: {
    rank: 1 | 2 | 3;
    userId: string;
    username: string;
    rewardType: RewardTicketType;
    rewardLabel: string;
  }[];
} {
  const distributedWeeks = getDistributedWeeks();
  if (distributedWeeks.includes(weekId)) {
    return { success: true, distributed: false, recipients: [] };
  }

  if (!standings || standings.length === 0) {
    return { success: true, distributed: false, recipients: [] };
  }

  const allPresentsRaw = localStorage.getItem(LOCAL_STORAGE_PRESENT_BOX);
  const allPresents: GiftBoxItem[] = allPresentsRaw ? JSON.parse(allPresentsRaw) : [];

  const recipients: {
    rank: 1 | 2 | 3;
    userId: string;
    username: string;
    rewardType: RewardTicketType;
    rewardLabel: string;
  }[] = [];

  const tierRewards: { rank: 1 | 2 | 3; type: RewardTicketType; label: string }[] = [
    { rank: 1, type: 'legend_guaranteed', label: 'レジェンド確定スカウト' },
    { rank: 2, type: 'purple_guaranteed', label: '紫確定スカウト' },
    { rank: 3, type: 'legend_purple_50', label: 'レジェンド・紫50%スカウト' },
  ];

  for (const tier of tierRewards) {
    const entry = standings[tier.rank - 1];
    if (entry && entry.userId) {
      recipients.push({
        rank: tier.rank,
        userId: entry.userId,
        username: entry.username,
        rewardType: tier.type,
        rewardLabel: tier.label,
      });

      // Create gift item
      const giftItem: GiftBoxItem = {
        id: `ranking_reward_${weekId}_rank${tier.rank}_${entry.userId}`,
        weekId,
        userId: entry.userId,
        title: `【第${seasonNum}週ランキング確定報酬】第${tier.rank}位`,
        description: `週間ランキング（${weekId}）にて第${tier.rank}位を獲得されました！おめでとうございます！`,
        rewardType: tier.type,
        amount: 1,
        isClaimed: false,
        createdAt: Date.now(),
        rank: tier.rank,
      };

      // Add to front of presents list
      allPresents.unshift(giftItem);
    }
  }

  saveAllPresents(allPresents);
  markWeekAsDistributed(weekId);

  // Archive to past rankings
  try {
    const pastRankings = getStoredPastRankings();
    if (!pastRankings.some((p) => p.weekId === weekId)) {
      pastRankings.unshift({
        weekId,
        weekLabel: `WEEK ${seasonNum} (${weekId})`,
        startDateMs: Date.now() - 7 * 24 * 60 * 60 * 1000,
        endDateMs: Date.now(),
        standings: standings.slice(0, 50),
        finalizedAt: Date.now(),
        rewardRecipients: recipients,
      });
      savePastRankings(pastRankings);
    }
  } catch (e) {
    console.warn('Failed to archive past rankings:', e);
  }

  return {
    success: true,
    distributed: true,
    recipients,
  };
}

