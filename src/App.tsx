import React, { useState, useEffect, useMemo } from 'react';
import {
  GameMode,
  Language,
  Player,
  Club,
  DraftHistoryEntry,
  FormationType,
  CustomPlayerPosition,
  FORMATIONS,
  UserTeam,
  CurrentDraftState,
  BlackBallSpinType,
} from './types';
import { ALL_CLUBS } from './data/clubs';
import {
  ALL_PLAYERS,
  getClubsByMode,
  getAvailableYears,
  findCandidatePlayers,
  getLegendaryCombination,
} from './data/playerDatabase';
import {
  findGoldenCandidates,
  getBallonDorWinner,
  getLegendPeakEra,
} from './data/legendaryEraDatabase';
import { findPurpleCandidates } from './data/purpleActivePlayers';
import { TRANSLATIONS } from './utils/translations';
import { soundManager } from './utils/audio';
import { Header } from './components/Header';
import { HomeScreen } from './components/HomeScreen';
import { SlotMachine } from './components/SlotMachine';
import { CandidateCard, NoCandidatesCard } from './components/CandidateCard';
import { PitchView } from './components/PitchView';
import { PvPView } from './components/PvPView';
import { PositionCountsBar } from './components/PositionCountsBar';
import { HistoryModal } from './components/HistoryModal';
import { SettingsModal } from './components/SettingsModal';
import { HowToPlayModal } from './components/HowToPlayModal';
import { PlayerDetailModal } from './components/PlayerDetailModal';
import { ModeSelectModal } from './components/ModeSelectModal';
import { getDefenseSquadId, setDefenseSquad } from './utils/pvpEngine';
import { saveLockedTeamToSupabase } from './utils/supabasePvP';
import { CelebrationModal } from './components/CelebrationModal';
import { ShareModal } from './components/ShareModal';
import { UpdateNotesModal } from './components/UpdateNotesModal';
import { GiftBoxModal } from './components/GiftBoxModal';
import { RewardScoutModal } from './components/RewardScoutModal';
import { OnlineSyncDebugModal } from './components/OnlineSyncDebugModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  getStoredUserTickets,
  getStoredPresents,
  claimPresentBoxItem,
  claimAllPresentBoxItems,
  consumeScoutTicket,
  ensureApologyGiftDistributed,
  getTotalTicketsCount,
  PresentBoxItem,
  UserRewardTickets,
  ScoutTicketType,
} from './utils/rewardScoutEngine';
import { checkAndPerformV132RankingReset } from './utils/supabasePvP';
import { getCurrentUserProfile } from './utils/pvpEngine';
import { initOnlineSyncManager } from './utils/onlineSyncManager';
import { CURRENT_VERSION } from './data/versionConfig';
import { DEFAULT_X_CHAR_LIMIT, STORAGE_KEY_X_CHAR_LIMIT } from './utils/shareUtils';
import { autoAssignSlot, remapPlayerSlots } from './utils/formationUtils';
import confetti from 'canvas-confetti';
import { CheckCircle2, Share2 } from 'lucide-react';

// Dedicated LocalStorage Keys
const STORAGE_KEY_TEAMS = 'footballDraft_teams';
const STORAGE_KEY_CURRENT_DRAFT = 'footballDraft_currentDraft';
const STORAGE_KEY_HISTORY = 'footballDraft_history';
const STORAGE_KEY_SETTINGS = 'footballDraft_settings';

// Legacy keys for backward compatibility migration
const LEGACY_STORAGE_KEY_HISTORY = 'football_draft_history_v1';
const LEGACY_STORAGE_KEY_SAVED_SQUAD = 'football_draft_current_squad_v1';
const LEGACY_STORAGE_KEY_LANG = 'football_draft_lang';

function createDefaultTeam(teamNumber = 1, mode: GameMode = 'europe'): UserTeam {
  return {
    teamId: `team_${Date.now()}_${teamNumber}`,
    teamNumber,
    name: `TEAM ${teamNumber}`,
    mode,
    players: [],
    formation: '4-3-3',
    playerSlots: {},
    customPositions: {},
    isCompleted: false,
    draftSkipsRemaining: 3,
    createdAt: Date.now(),
  };
}

export default function App() {
  // 1. Settings state (Language & Sound)
  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          if (parsed.language) return parsed.language;
        }
        const legacyLang = localStorage.getItem(LEGACY_STORAGE_KEY_LANG);
        if (legacyLang === 'ja' || legacyLang === 'en' || legacyLang === 'es') return legacyLang;
      } catch (e) {
        // ignore
      }
    }
    return 'ja';
  });

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          if (typeof parsed.soundEnabled === 'boolean') return parsed.soundEnabled;
        }
      } catch (e) {
        // ignore
      }
    }
    return true;
  });

  const [xCharLimit, setXCharLimit] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedLimit = localStorage.getItem(STORAGE_KEY_X_CHAR_LIMIT);
        if (savedLimit) {
          const val = Number(savedLimit);
          if (!isNaN(val) && val > 0) return val;
        }
        const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          if (typeof parsed.xCharLimit === 'number' && parsed.xCharLimit > 0) return parsed.xCharLimit;
        }
      } catch (e) {
        // ignore
      }
    }
    return DEFAULT_X_CHAR_LIMIT;
  });

  const t = TRANSLATIONS[language];

  // 2. Navigation tab: 'home' | 'draft' | 'team' | 'history' | 'pvp'
  const [currentView, setCurrentView] = useState<'home' | 'draft' | 'team' | 'history' | 'pvp'>('home');

  // 3. Multi-Team Management state
  const [teams, setTeams] = useState<UserTeam[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_TEAMS);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
        // Check legacy squad
        const legacySquad = localStorage.getItem(LEGACY_STORAGE_KEY_SAVED_SQUAD);
        if (legacySquad) {
          const parsed = JSON.parse(legacySquad);
          if (Array.isArray(parsed.myTeam)) {
            const migratedTeam: UserTeam = {
              teamId: `team_migrated_${Date.now()}`,
              teamNumber: 1,
              name: 'TEAM 1',
              mode: 'europe',
              players: parsed.myTeam,
              formation: parsed.formation || '4-3-3',
              playerSlots: parsed.playerSlots || {},
              customPositions: parsed.customPositions || {},
              isCompleted: parsed.myTeam.length === 11,
              createdAt: Date.now(),
            };
            return [migratedTeam];
          }
        }
      } catch (e) {
        console.error('Failed to load teams', e);
      }
    }
    return [createDefaultTeam(1, 'europe')];
  });

  const [activeTeamId, setActiveTeamId] = useState<string>(() => {
    return teams[0]?.teamId || 'team_default';
  });

  // Defense Squad ID state
  const [defenseSquadId, setDefenseSquadId] = useState<string>(() => {
    return getDefenseSquadId(teams);
  });

  const handleSetDefenseSquad = (teamId: string) => {
    setDefenseSquad(teamId, teams);
    setDefenseSquadId(teamId);
  };

  // Keep activeTeam strictly synchronized
  const activeTeam = useMemo(() => {
    return teams.find((tItem) => tItem.teamId === activeTeamId) || teams[0] || createDefaultTeam(1, 'europe');
  }, [teams, activeTeamId]);

  // Mode derived from active team
  const mode = activeTeam.mode || 'europe';

  // 4. Draft state with persistent draft tracking
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);
  const [candidatePlayers, setCandidatePlayers] = useState<Player[]>([]);
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [hasCurrentDraft, setHasCurrentDraft] = useState<boolean>(false);
  const [skipsRemaining, setSkipsRemaining] = useState<number>(3);
  const [acquiredPlayerBanner, setAcquiredPlayerBanner] = useState<Player | null>(null);
  const [celebratingTeam, setCelebratingTeam] = useState<UserTeam | null>(null);

  // Black Ball, Golden Event & Purple Special State
  const [blackBallSpinType, setBlackBallSpinType] = useState<BlackBallSpinType>('none');
  const [blackBallStage, setBlackBallStage] = useState<'spinning-normal' | 'lightning-striking' | 'blackball-spinning' | 'revealed'>('revealed');
  const [isBlackBallResult, setIsBlackBallResult] = useState<boolean>(false);
  const [isGoldenResult, setIsGoldenResult] = useState<boolean>(false);
  const [isPurpleResult, setIsPurpleResult] = useState<boolean>(false);
  const [isPurpleSpin, setIsPurpleSpin] = useState<boolean>(false);

  // Restore active draft state on boot
  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(STORAGE_KEY_CURRENT_DRAFT);
      if (savedDraft) {
        const parsed: CurrentDraftState = JSON.parse(savedDraft);
        if (parsed.hasCurrentDraft) {
          setSelectedYear(parsed.selectedYear);
          setSelectedClub(parsed.selectedClub);
          setCandidatePlayers(parsed.candidatePlayers || []);
          setHasCurrentDraft(parsed.hasCurrentDraft);
          const matchedTeam = parsed.activeTeamId ? teams.find((tItem) => tItem.teamId === parsed.activeTeamId) : activeTeam;
          setSkipsRemaining(matchedTeam?.draftSkipsRemaining ?? parsed.skipsRemaining ?? 3);
          setBlackBallSpinType(parsed.blackBallSpinType || 'none');
          setBlackBallStage(parsed.blackBallStage || 'revealed');
          setIsBlackBallResult(parsed.isBlackBallResult || false);
          setIsGoldenResult(parsed.isGoldenResult || false);
          setIsPurpleResult(parsed.isPurpleResult || false);
          if (parsed.activeTeamId && teams.some((tItem) => tItem.teamId === parsed.activeTeamId)) {
            setActiveTeamId(parsed.activeTeamId);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load current draft state', e);
    }
  }, []);

  // Save current draft state to localStorage
  useEffect(() => {
    try {
      const draftState: CurrentDraftState = {
        activeTeamId: activeTeam.teamId,
        mode: activeTeam.mode,
        selectedYear,
        selectedClub,
        candidatePlayers,
        isSpinning,
        hasCurrentDraft,
        skipsRemaining,
        blackBallSpinType,
        blackBallStage,
        isBlackBallResult,
        isGoldenResult,
        isPurpleResult,
      };
      localStorage.setItem(STORAGE_KEY_CURRENT_DRAFT, JSON.stringify(draftState));
    } catch (e) {
      console.error('Failed to save current draft state', e);
    }
  }, [
    activeTeam.teamId,
    activeTeam.mode,
    selectedYear,
    selectedClub,
    candidatePlayers,
    isSpinning,
    hasCurrentDraft,
    skipsRemaining,
    blackBallSpinType,
    blackBallStage,
    isBlackBallResult,
    isGoldenResult,
    isPurpleResult,
  ]);

  // 5. Persistent History state (never wiped on game reset)
  const [draftHistory, setDraftHistory] = useState<DraftHistoryEntry[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_HISTORY);
        if (saved) return JSON.parse(saved);
        const legacyHistory = localStorage.getItem(LEGACY_STORAGE_KEY_HISTORY);
        if (legacyHistory) return JSON.parse(legacyHistory);
      } catch (e) {
        console.error('Failed to load draft history', e);
      }
    }
    return [];
  });

  // Save history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(draftHistory));
    } catch (e) {
      console.error('Failed to save history', e);
    }
  }, [draftHistory]);

  // Save teams to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_TEAMS, JSON.stringify(teams));
    } catch (e) {
      console.error('Failed to save teams', e);
    }
  }, [teams]);

  // Save settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_SETTINGS,
        JSON.stringify({ language, soundEnabled, xCharLimit })
      );
      localStorage.setItem(STORAGE_KEY_X_CHAR_LIMIT, String(xCharLimit));
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  }, [language, soundEnabled, xCharLimit]);

  // Modals
  const [isModeSelectOpen, setIsModeSelectOpen] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isHowToPlayOpen, setIsHowToPlayOpen] = useState<boolean>(false);
  const [isUpdateNotesOpen, setIsUpdateNotesOpen] = useState<boolean>(false);
  const [sharingTeam, setSharingTeam] = useState<UserTeam | null>(null);

  // Modals for Gift Box and Reward Scout
  const [isGiftBoxOpen, setIsGiftBoxOpen] = useState<boolean>(false);
  const [isRewardScoutOpen, setIsRewardScoutOpen] = useState<boolean>(false);
  const [isSyncDebugOpen, setIsSyncDebugOpen] = useState<boolean>(false);
  const [rewardTickets, setRewardTickets] = useState<UserRewardTickets>(() => getStoredUserTickets());
  const [presents, setPresents] = useState<PresentBoxItem[]>([]);

  // User Profile for persistent rewards
  const userProfile = useMemo(() => getCurrentUserProfile(activeTeam, teams), [activeTeam, teams]);

  // Initial mount: v1.3.2 ranking reset & apology gift
  useEffect(() => {
    // 1. Perform v1.3.2 ranking reset (clears past matches and rankings, strictly preserves all other data)
    checkAndPerformV132RankingReset();

    // 2. Distribute apology gift "Legend 20% Scout x1" to all users
    if (userProfile.userId) {
      ensureApologyGiftDistributed(userProfile.userId);
      const loadedPresents = getStoredPresents(userProfile.userId);
      setPresents(loadedPresents);
    }
    setRewardTickets(getStoredUserTickets());
  }, [userProfile.userId]);

  // Version 1.4.0 Online Sync Heartbeat & Automatic 10-Minute Periodic Sync
  useEffect(() => {
    const cleanup = initOnlineSyncManager();
    return cleanup;
  }, []);

  const handleClaimGift = (giftId: string) => {
    const res = claimPresentBoxItem(giftId, userProfile.userId);
    setPresents(res.updatedPresents || getStoredPresents(userProfile.userId));
    setRewardTickets(res.updatedTickets || getStoredUserTickets());
  };

  const handleClaimAllGifts = () => {
    const res = claimAllPresentBoxItems(userProfile.userId);
    setPresents(res.updatedPresents || getStoredPresents(userProfile.userId));
    setRewardTickets(res.updatedTickets || getStoredUserTickets());
  };

  const handleConsumeTicket = (ticketType: ScoutTicketType): boolean => {
    const success = consumeScoutTicket(ticketType);
    if (success) {
      setRewardTickets(getStoredUserTickets());
    }
    return success;
  };

  // Language & Sound handlers
  const handleLanguageChange = (newLang: Language) => {
    setLanguage(newLang);
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundManager.sfxEnabled = next;
  };

  // Mutate active team properties in teams state (prevent mutation if locked)
  const updateActiveTeam = (updater: (prevTeam: UserTeam) => UserTeam) => {
    if (activeTeam.isLocked) {
      console.warn('Cannot edit locked team');
      return;
    }
    setTeams((prevTeams) =>
      prevTeams.map((tItem) => {
        if (tItem.teamId === activeTeam.teamId) {
          return updater(tItem);
        }
        return tItem;
      })
    );
  };

  // Team Lock handler (v1.2.0)
  const handleToggleTeamLock = (teamId: string, willLock: boolean) => {
    let updatedList: UserTeam[] = [];
    setTeams((prevTeams) => {
      updatedList = prevTeams.map((tItem) =>
        tItem.teamId === teamId ? { ...tItem, isLocked: willLock } : tItem
      );
      return updatedList;
    });

    const target = (updatedList.length > 0 ? updatedList : teams).find((t) => t.teamId === teamId);
    if (target) {
      if (willLock) {
        handleSetDefenseSquad(teamId);
      }
      saveLockedTeamToSupabase({ ...target, isLocked: willLock }).catch((err) => {
        console.warn('Sync locked team to Supabase failed:', err);
      });
    }
  };

  // SWITCH ACTIVE TEAM (Strictly preserves each team's own skips & draft state)
  const switchActiveTeam = (targetTeamId: string) => {
    if (targetTeamId === activeTeamId) return;

    // Snapshot current active team's draft state
    const currentDraftStateSnapshot: CurrentDraftState = {
      activeTeamId,
      mode: activeTeam.mode,
      selectedYear,
      selectedClub,
      candidatePlayers,
      isSpinning,
      hasCurrentDraft,
      skipsRemaining,
      blackBallSpinType,
      blackBallStage,
      isBlackBallResult,
      isGoldenResult,
      isPurpleResult,
    };

    // Save snapshot to current active team
    setTeams((prev) =>
      prev.map((t) => {
        if (t.teamId === activeTeamId) {
          return {
            ...t,
            draftSkipsRemaining: skipsRemaining,
            draftState: currentDraftStateSnapshot,
          };
        }
        return t;
      })
    );

    // Find and switch to target team
    const targetTeam = teams.find((t) => t.teamId === targetTeamId);
    if (targetTeam) {
      setActiveTeamId(targetTeamId);

      if (targetTeam.draftState && !targetTeam.isCompleted) {
        const ds = targetTeam.draftState;
        setSelectedYear(ds.selectedYear);
        setSelectedClub(ds.selectedClub);
        setCandidatePlayers(ds.candidatePlayers || []);
        setIsSpinning(false);
        setHasCurrentDraft(ds.hasCurrentDraft || false);
        setSkipsRemaining(targetTeam.draftSkipsRemaining ?? ds.skipsRemaining ?? 3);
        setBlackBallSpinType(ds.blackBallSpinType || 'none');
        setBlackBallStage(ds.blackBallStage || 'revealed');
        setIsBlackBallResult(ds.isBlackBallResult || false);
        setIsGoldenResult(ds.isGoldenResult || false);
        setIsPurpleResult(ds.isPurpleResult || false);
      } else {
        setSelectedYear(null);
        setSelectedClub(null);
        setCandidatePlayers([]);
        setIsSpinning(false);
        setHasCurrentDraft(false);
        // Use team's recorded skips or initial 3
        setSkipsRemaining(targetTeam.draftSkipsRemaining ?? 3);
        setBlackBallSpinType('none');
        setBlackBallStage('revealed');
        setIsBlackBallResult(false);
        setIsGoldenResult(false);
        setIsPurpleResult(false);
      }
    }
  };

  // CREATE NEW TEAM (Team 2, Team 3, etc.)
  const handleCreateNewTeam = () => {
    // Save current active team state before switching
    setTeams((prev) =>
      prev.map((t) => {
        if (t.teamId === activeTeamId) {
          return {
            ...t,
            draftSkipsRemaining: skipsRemaining,
          };
        }
        return t;
      })
    );

    const nextTeamNumber = teams.length + 1;
    const newTeam = createDefaultTeam(nextTeamNumber, mode);
    setTeams((prev) => [...prev, newTeam]);
    setActiveTeamId(newTeam.teamId);

    // Reset draft state for new team
    setSelectedYear(null);
    setSelectedClub(null);
    setCandidatePlayers([]);
    setIsSpinning(false);
    setHasCurrentDraft(false);
    setSkipsRemaining(3);
    setAcquiredPlayerBanner(null);
    setBlackBallSpinType('none');
    setBlackBallStage('revealed');
    setIsBlackBallResult(false);
    setIsGoldenResult(false);
    setIsPurpleResult(false);

    setCurrentView('draft');
  };

  // DELETE TEAM (Strictly protect locked teams)
  const handleDeleteTeam = (teamId: string) => {
    const target = teams.find((tItem) => tItem.teamId === teamId);
    if (!target) return;
    if (target.isLocked) {
      console.warn('Cannot delete locked team:', teamId);
      return;
    }
    if (teams.length <= 1) return;
    const filtered = teams.filter((tItem) => tItem.teamId !== teamId);
    setTeams(filtered);
    if (activeTeamId === teamId) {
      setActiveTeamId(filtered[0].teamId);
    }
  };

  // SELECT ACTIVE TEAM
  const handleSelectTeam = (teamId: string) => {
    switchActiveTeam(teamId);
  };

  // CONTINUE DRAFT FOR A SPECIFIC TEAM
  const handleContinueDraft = (teamId: string) => {
    switchActiveTeam(teamId);
    setCurrentView('draft');
  };

  // Change mode for active team or start fresh mode
  const handleSelectMode = (newMode: GameMode) => {
    updateActiveTeam((prev) => ({
      ...prev,
      mode: newMode,
    }));
    setSelectedYear(null);
    setSelectedClub(null);
    setCandidatePlayers([]);
    setIsSpinning(false);
    setHasCurrentDraft(false);
    setSkipsRemaining(3);
    setAcquiredPlayerBanner(null);
  };

  // Reset ALL game data (Teams + Draft). HISTORY remains completely preserved! Locked teams are strictly protected!
  const handleResetGame = () => {
    const lockedTeams = teams.filter((t) => t.isLocked);
    let nextTeams: UserTeam[];
    if (lockedTeams.length > 0) {
      nextTeams = lockedTeams;
    } else {
      nextTeams = [createDefaultTeam(1, mode)];
    }
    setTeams(nextTeams);
    setActiveTeamId(nextTeams[0].teamId);

    setSelectedYear(null);
    setSelectedClub(null);
    setCandidatePlayers([]);
    setIsSpinning(false);
    setHasCurrentDraft(false);
    setSkipsRemaining(3);
    setAcquiredPlayerBanner(null);
    setBlackBallSpinType('none');
    setBlackBallStage('revealed');
    setIsBlackBallResult(false);
    setIsGoldenResult(false);
    setIsPurpleResult(false);

    try {
      localStorage.removeItem(STORAGE_KEY_CURRENT_DRAFT);
      if (lockedTeams.length > 0) {
        localStorage.setItem(STORAGE_KEY_TEAMS, JSON.stringify(lockedTeams));
      } else {
        localStorage.removeItem(STORAGE_KEY_TEAMS);
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY_SAVED_SQUAD);
    } catch (e) {
      // ignore
    }
  };

  // Clear History only
  const handleClearHistory = () => {
    setDraftHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY_HISTORY);
      localStorage.removeItem(LEGACY_STORAGE_KEY_HISTORY);
    } catch (e) {
      // ignore
    }
  };

  // Delete a single entry from history
  const handleDeleteHistoryEntry = (entryId: string) => {
    setDraftHistory((prev) => prev.filter((item) => item.id !== entryId));
  };

  // CORE ROULETTE SPIN LOGIC
  const handleSpinDraft = () => {
    if (isSpinning || hasCurrentDraft || activeTeam.players.length >= 11) return;

    soundManager.playButtonClick();
    setIsSpinning(true);
    setHasCurrentDraft(true);
    setCandidatePlayers([]);
    setAcquiredPlayerBanner(null);
    setIsBlackBallResult(false);
    setIsGoldenResult(false);
    setIsPurpleResult(false);
    setIsPurpleSpin(false);

    const clubs = getClubsByMode(mode);
    const years = getAvailableYears(mode);
    const currentTeamPlayerIds = activeTeam.players.map((p) => p.playerId);
    const currentTeamPersonIds = activeTeam.players.map((p) => p.personId);

    // 🟣 PRIORITY 0: PURPLE SPECIAL EVENT (8% occurrence probability)
    // - Triggered at exactly 8% chance
    // - Purple Special visual performance & animation
    // - Exactly 3 candidates from the Purple Superstars pool
    // - Strictly excluded from normal draft candidates
    const isPurpleTrigger = Math.random() < 0.08;

    if (isPurpleTrigger) {
      const purpleCandidates = findPurpleCandidates(
        currentTeamPlayerIds,
        currentTeamPersonIds,
        3
      );

      if (purpleCandidates.length > 0) {
        setIsPurpleSpin(true);
        setBlackBallSpinType('none');
        setBlackBallStage('spinning-normal');
        soundManager.playBlackBallAura();

        // Staged lightning flash & electric excitement
        setTimeout(() => {
          setBlackBallStage('lightning-striking');
          soundManager.playGoldenLightning();
        }, 400);

        setTimeout(() => {
          setBlackBallStage('blackball-spinning');
        }, 850);

        setTimeout(() => {
          const primaryPlayer = purpleCandidates[0];
          setSelectedYear(primaryPlayer.joiningYear);
          const matchedClub = clubs.find((c) => c.id === primaryPlayer.clubId) || {
            id: primaryPlayer.clubId || 'special_purple',
            name: primaryPlayer.clubName,
            nameJa: primaryPlayer.clubName,
            nameEn: primaryPlayer.clubName,
            nameEs: primaryPlayer.clubName,
            league: 'Active Superstars',
            country: 'World',
            countryFlag: primaryPlayer.nationalityFlag || '🌐',
            crestEmoji: '🟣',
            primaryColor: '#a855f7',
            secondaryColor: '#ec4899',
          };
          setSelectedClub(matchedClub);
          setIsSpinning(false);
          setIsPurpleSpin(false);
          setBlackBallStage('revealed');
          setIsBlackBallResult(false);
          setIsGoldenResult(false);
          setIsPurpleResult(true);
          soundManager.playSlotStop();
          soundManager.playVictory();

          // Purple / Fuchsia Confetti Burst
          confetti({
            particleCount: 160,
            spread: 100,
            origin: { y: 0.5 },
            colors: ['#d946ef', '#a855f7', '#8b5cf6', '#ffffff', '#ec4899', '#f0abfc'],
          });

          // Set all 3 purple superstars as candidates
          setCandidatePlayers(purpleCandidates);
        }, 2400);
        return;
      }
    }

    // 2.1% Rare Event trigger (approx 1.17x increase from 1.8%) for Golden Special / Peak Era staging
    const isRareTrigger = Math.random() < 0.021;

    if (isRareTrigger) {
      // 🥇 PRIORITY 1: GOLDEN SUPREME EVENT (3 randomized candidates across eras/clubs)
      const goldenCandidates = findGoldenCandidates(
        mode,
        currentTeamPlayerIds,
        currentTeamPersonIds,
        3
      );

      if (goldenCandidates.length > 0) {
        const primaryPlayer = goldenCandidates[0];
        const targetYear = primaryPlayer.joiningYear;
        const targetClub = clubs.find((c) => c.id === primaryPlayer.clubId) || clubs[0];
        const isLightning = Math.random() < 0.6;
        const spinType: BlackBallSpinType = isLightning
          ? 'golden-lightning-ballon-dor'
          : 'golden-ballon-dor';

        setBlackBallSpinType(spinType);
        setBlackBallStage('spinning-normal');
        soundManager.playBlackBallAura();

        if (isLightning) {
          setTimeout(() => {
            setBlackBallStage('lightning-striking');
            soundManager.playGoldenLightning();
          }, 400);

          setTimeout(() => {
            setBlackBallStage('blackball-spinning');
          }, 800);
        } else {
          setTimeout(() => {
            setBlackBallStage('blackball-spinning');
          }, 600);
        }

        setTimeout(() => {
          setSelectedYear(targetYear);
          setSelectedClub(targetClub);
          setIsSpinning(false);
          setBlackBallStage('revealed');
          setIsBlackBallResult(true);
          setIsGoldenResult(true);
          setIsPurpleResult(false);
          soundManager.playSlotStop();
          soundManager.playGoldenFanfare();

          // Golden Confetti Burst
          confetti({
            particleCount: 160,
            spread: 100,
            origin: { y: 0.5 },
            colors: ['#fde047', '#eab308', '#ca8a04', '#ffffff', '#fbbf24'],
          });

          // Set all 3 randomized Golden candidates for user selection
          setCandidatePlayers(goldenCandidates);
        }, 2400);
        return;
      }

      // 🥈 PRIORITY 2: BLACK BALL (LEGEND PEAK ERA)
      const combo = getLegendaryCombination(mode, currentTeamPlayerIds, currentTeamPersonIds);
      const targetYear = combo ? combo.year : 2018;
      const targetClub = combo ? (clubs.find((c) => c.id === combo.clubId) || clubs[0]) : clubs[0];
      const isLightning = Math.random() < 0.5;
      const spinType: BlackBallSpinType = isLightning ? 'lightning-blackball' : 'normal-blackball';

      setBlackBallSpinType(spinType);
      setBlackBallStage('spinning-normal');
      soundManager.playBlackBallAura();

      if (isLightning) {
        setTimeout(() => {
          setBlackBallStage('lightning-striking');
          soundManager.playLightningElectricBuzz();
        }, 450);

        setTimeout(() => {
          setBlackBallStage('blackball-spinning');
        }, 700);
      } else {
        setTimeout(() => {
          setBlackBallStage('blackball-spinning');
        }, 550);
      }

      setTimeout(() => {
        setSelectedYear(targetYear);
        setSelectedClub(targetClub);
        setIsSpinning(false);
        setBlackBallStage('revealed');
        setIsBlackBallResult(true);
        setIsGoldenResult(false);
        setIsPurpleResult(false);
        soundManager.playSlotStop();
        soundManager.playVictory();

        // Victory Confetti
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.55 },
          colors: ['#fbbf24', '#f59e0b', '#10b981', '#ffffff'],
        });

        const candidates = findCandidatePlayers(
          mode,
          targetYear,
          targetClub.id,
          currentTeamPlayerIds,
          currentTeamPersonIds
        );
        setCandidatePlayers(candidates.length > 0 ? candidates : (combo ? [combo.player] : []));
      }, 2200);
      return;
    }

    // 🥉 REGULAR NORMAL ROULETTE SPIN
    setBlackBallSpinType('none');
    setBlackBallStage('spinning-normal');
    setIsGoldenResult(false);
    setIsPurpleResult(false);

    setTimeout(() => {
      // 80% weighted selection toward populated combinations
      const matchingPlayers = ALL_PLAYERS.filter(
        (p) =>
          p.clubId &&
          clubs.some((c) => c.id === p.clubId) &&
          !currentTeamPlayerIds.includes(p.playerId) &&
          !currentTeamPersonIds.includes(p.personId)
      );

      let targetYear: number;
      let targetClub: Club;

      if (matchingPlayers.length > 0 && Math.random() < 0.8) {
        // レジェンド選手の排出率を約1.15倍（1.1〜1.2倍の指定範囲内）に微増
        const totalWeight = matchingPlayers.reduce(
          (acc, p) => acc + (p.isLegendary ? 1.15 : 1.0),
          0
        );
        let randomWeight = Math.random() * totalWeight;
        let pickedPlayer = matchingPlayers[0];
        for (const p of matchingPlayers) {
          const weight = p.isLegendary ? 1.15 : 1.0;
          if (randomWeight < weight) {
            pickedPlayer = p;
            break;
          }
          randomWeight -= weight;
        }
        targetYear = pickedPlayer.joiningYear;
        targetClub = clubs.find((c) => c.id === pickedPlayer.clubId) || clubs[0];
      } else {
        targetYear = years[Math.floor(Math.random() * years.length)];
        targetClub = clubs[Math.floor(Math.random() * clubs.length)];
      }

      setSelectedYear(targetYear);
      setSelectedClub(targetClub);
      soundManager.playSlotStop();

      // Search matching real candidates
      const candidates = findCandidatePlayers(
        mode,
        targetYear,
        targetClub.id,
        currentTeamPlayerIds,
        currentTeamPersonIds
      );

      setCandidatePlayers(candidates);
      setIsSpinning(false);
      setBlackBallStage('revealed');
    }, 1200);
  };

  // Handle Skip (consumes 1 skip count and unlocks next spin)
  const handleSkip = () => {
    if (skipsRemaining <= 0 || isSpinning) return;
    soundManager.playSkip();
    const nextSkips = Math.max(0, skipsRemaining - 1);
    setSkipsRemaining(nextSkips);
    updateActiveTeam((prev) => ({
      ...prev,
      draftSkipsRemaining: nextSkips,
    }));
    setCandidatePlayers([]);
    setSelectedYear(null);
    setSelectedClub(null);
    setHasCurrentDraft(false);
    setIsBlackBallResult(false);
    setIsGoldenResult(false);
    setIsPurpleResult(false);
    setBlackBallSpinType('none');
  };

  // Handle Free Skip / Next Draft (When No Players Found)
  const handleNextDraftFree = () => {
    soundManager.playButtonClick();
    setCandidatePlayers([]);
    setSelectedYear(null);
    setSelectedClub(null);
    setHasCurrentDraft(false);
    setIsBlackBallResult(false);
    setIsGoldenResult(false);
    setIsPurpleResult(false);
    setBlackBallSpinType('none');
  };


  // Handle Draft Player Selection
  const handleDraftPlayer = (player: Player) => {
    if (activeTeam.players.length >= 11) return;

    const newPlayers = [...activeTeam.players, player];
    const newSlots = autoAssignSlot(player, activeTeam.playerSlots, activeTeam.formation);
    
    // Double safeguard: ensure player.playerId is 100% assigned in newSlots
    if (!Object.values(newSlots).includes(player.playerId)) {
      const basePreset = activeTeam.formation === 'CUSTOM' ? '4-3-3' : activeTeam.formation;
      const fSlots = FORMATIONS[basePreset]?.slots || FORMATIONS['4-3-3'].slots;
      const openSlot = fSlots.find((s) => !newSlots[s.id]);
      if (openSlot) {
        newSlots[openSlot.id] = player.playerId;
      } else {
        newSlots[`slot_extra_${Date.now()}`] = player.playerId;
      }
    }

    const isCompleted = newPlayers.length === 11;

    const updatedTeam: UserTeam = {
      ...activeTeam,
      players: newPlayers,
      playerSlots: newSlots,
      isCompleted,
      completedAt: isCompleted ? Date.now() : activeTeam.completedAt,
      draftSkipsRemaining: skipsRemaining,
    };

    updateActiveTeam(() => updatedTeam);

    // Record to persistent Draft History with multilingual metadata
    const dbClub = ALL_CLUBS.find((c) => c.id === player.clubId);
    const historyEntry: DraftHistoryEntry = {
      id: `${Date.now()}_${player.playerId}`,
      playerId: player.playerId,
      playerName: player.playerName,
      nameJa: player.nameJa,
      nameEn: player.nameEn,
      nameEs: player.nameEs,
      clubId: player.clubId,
      clubName: player.clubName,
      clubNameJa: dbClub?.nameJa,
      clubNameEn: dbClub?.nameEn,
      clubNameEs: dbClub?.nameEs,
      joiningYear: player.joiningYear,
      position: player.position,
      subPosition: player.subPosition,
      nationality: player.nationality,
      nationalityJa: player.nationalityJa,
      nationalityEn: player.nationalityEn,
      nationalityEs: player.nationalityEs,
      nationalityFlag: player.nationalityFlag,
      rating: player.rating,
      isLegendary: !!player.isLegendary,
      timestamp: Date.now(),
      mode,
      teamId: activeTeam.teamId,
      teamNumber: activeTeam.teamNumber,
      teamName: activeTeam.name,
    };
    setDraftHistory((prev) => [historyEntry, ...prev]);

    // Show "PLAYER ACQUIRED" notice
    setAcquiredPlayerBanner(player);
    setCandidatePlayers([]);

    // Check if 11 players completed!
    if (isCompleted) {
      soundManager.playVictory();
      confetti({
        particleCount: 150,
        spread: 90,
        origin: { y: 0.6 },
      });
      setTimeout(() => {
        setAcquiredPlayerBanner(null);
        setHasCurrentDraft(false);
        setIsPurpleResult(false);
        setCelebratingTeam(updatedTeam);
      }, 1800);
    } else {
      setTimeout(() => {
        setAcquiredPlayerBanner(null);
        setSelectedYear(null);
        setSelectedClub(null);
        setHasCurrentDraft(false);
        setIsBlackBallResult(false);
        setIsGoldenResult(false);
        setIsPurpleResult(false);
        setBlackBallSpinType('none');
      }, 2000);
    }
  };

  const handleAcquireScoutPlayer = (player: Player) => {
    soundManager.playFanfare();
    let targetTeam = activeTeam;
    if (activeTeam.players.length < 11) {
      handleDraftPlayer(player);
      targetTeam = activeTeam;
    } else {
      const incompleteTeam = teams.find((t) => t.players.length < 11);
      if (incompleteTeam) {
        targetTeam = incompleteTeam;
        setActiveTeamId(incompleteTeam.teamId);
        const newPlayers = [...incompleteTeam.players, player];
        const newSlots = autoAssignSlot(player, incompleteTeam.playerSlots, incompleteTeam.formation);
        const isCompleted = newPlayers.length === 11;
        const updated: UserTeam = {
          ...incompleteTeam,
          players: newPlayers,
          playerSlots: newSlots,
          isCompleted,
          completedAt: isCompleted ? Date.now() : incompleteTeam.completedAt,
        };
        setTeams((prev) => prev.map((t) => (t.teamId === incompleteTeam.teamId ? updated : t)));
      } else {
        const newTeamNum = teams.length + 1;
        const newTeam = createDefaultTeam(newTeamNum, activeTeam.mode);
        newTeam.players = [player];
        newTeam.playerSlots = autoAssignSlot(player, {}, newTeam.formation);
        setTeams((prev) => [...prev, newTeam]);
        setActiveTeamId(newTeam.teamId);
        targetTeam = newTeam;
      }

      // Record in draft history
      const historyEntry: DraftHistoryEntry = {
        id: `scout_history_${Date.now()}_${player.playerId}`,
        playerId: player.playerId,
        playerName: player.playerName,
        nameJa: player.nameJa,
        nameEn: player.nameEn,
        nameEs: player.nameEs,
        clubId: player.clubId,
        clubName: player.clubName,
        joiningYear: player.joiningYear,
        position: player.position,
        subPosition: player.subPosition,
        nationality: player.nationality,
        nationalityJa: player.nationalityJa,
        nationalityEn: player.nationalityEn,
        nationalityEs: player.nationalityEs,
        nationalityFlag: player.nationalityFlag,
        rating: player.rating,
        isLegendary: !!player.isLegendary,
        timestamp: Date.now(),
        mode,
        teamId: targetTeam.teamId,
        teamNumber: targetTeam.teamNumber,
        teamName: targetTeam.name,
      };
      setDraftHistory((prev) => [historyEntry, ...prev]);
    }
    setAcquiredPlayerBanner(player);
    setTimeout(() => {
      setAcquiredPlayerBanner(null);
    }, 2800);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950 font-sans">
      {/* Main Top Header */}
      <Header
        mode={mode}
        onSelectMode={(m) => {
          handleSelectMode(m);
        }}
        language={language}
        onLanguageChange={handleLanguageChange}
        activeTab={currentView}
        onTabChange={setCurrentView}
        teamCount={activeTeam.players.length}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenHowToPlay={() => setIsHowToPlayOpen(true)}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onOpenGiftBox={() => setIsGiftBoxOpen(true)}
        onOpenScoutModal={() => setIsRewardScoutOpen(true)}
        onOpenSyncDebug={() => setIsSyncDebugOpen(true)}
        unclaimedGiftsCount={presents.filter((p) => !p.isClaimed).length}
        totalTicketsCount={getTotalTicketsCount(rewardTickets)}
      />

      {/* Main App Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-6 sm:space-y-8">
        {/* VIEW 1: HOME SCREEN */}
        {currentView === 'home' && (
          <HomeScreen
            mode={mode}
            onOpenModeSelect={() => setIsModeSelectOpen(true)}
            onNavigate={setCurrentView}
            onOpenHowToPlay={() => setIsHowToPlayOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenUpdateNotes={() => setIsUpdateNotesOpen(true)}
            onOpenGiftBox={() => setIsGiftBoxOpen(true)}
            onOpenScoutModal={() => setIsRewardScoutOpen(true)}
            unclaimedGiftsCount={presents.filter((p) => !p.isClaimed).length}
            totalTicketsCount={getTotalTicketsCount(rewardTickets)}
            teams={teams}
            activeTeam={activeTeam}
            myTeam={activeTeam.players}
            historyCount={draftHistory.length}
            language={language}
            onCreateNewTeam={handleCreateNewTeam}
            hasActiveSpin={hasCurrentDraft}
          />
        )}

        {/* VIEW 2: DRAFT WORKSPACE */}
        {currentView === 'draft' && (
          <div className="space-y-6 sm:space-y-8">
            {/* Slot Machine Roulette Component */}
            <SlotMachine
              mode={mode}
              language={language}
              selectedYear={selectedYear}
              selectedClub={selectedClub}
              isSpinning={isSpinning}
              blackBallSpinType={blackBallSpinType}
              blackBallStage={blackBallStage}
              isBlackBallResult={isBlackBallResult}
              isGoldenResult={isGoldenResult}
              isPurpleResult={isPurpleResult}
              isPurpleSpin={isPurpleSpin}
              hasCurrentDraft={hasCurrentDraft}
              skipsRemaining={skipsRemaining}
              onSpin={handleSpinDraft}
              onSkip={handleSkip}
              disabled={isSpinning}
              isTeamFull={activeTeam.players.length >= 11}
            />

            {/* Acquired Player Flash Banner (Displayed for 2 seconds) */}
            {acquiredPlayerBanner && (
              <div
                id="player-acquired-banner"
                className="max-w-xl mx-auto bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-600 text-slate-950 p-4 rounded-2xl shadow-2xl shadow-emerald-500/40 border border-emerald-300 flex items-center justify-between animate-bounce"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-950 text-emerald-400 flex items-center justify-center font-black text-xl">
                    <CheckCircle2 className="w-6 h-6 stroke-[3]" />
                  </div>
                  <div>
                    <div className="font-heading font-black text-base sm:text-lg leading-tight">
                      {t.playerAcquired}
                    </div>
                    <div className="text-xs font-bold text-slate-950/80">
                      {acquiredPlayerBanner.playerName} ({acquiredPlayerBanner.clubName} • {acquiredPlayerBanner.position})
                    </div>
                  </div>
                </div>
                <span className="text-xs font-mono font-black px-2.5 py-1 rounded-full bg-slate-950 text-emerald-400">
                  {activeTeam.players.length}/11
                </span>
              </div>
            )}

            {/* Candidates Section */}
            {hasCurrentDraft && !isSpinning && !acquiredPlayerBanner && (
              <div id="candidates-container" className="space-y-4 pt-2">
                {/* Squad Position Counts Bar */}
                <div className="max-w-3xl mx-auto">
                  <PositionCountsBar players={activeTeam.players} language={language} />
                </div>

                <div className="flex items-center justify-between max-w-3xl mx-auto px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 font-heading font-black text-base sm:text-lg">
                      🎯 CANDIDATES
                    </span>
                    <span className="text-xs bg-slate-800 text-slate-300 font-bold px-2 py-0.5 rounded-full border border-slate-700">
                      {candidatePlayers.length} FOUND
                    </span>
                  </div>
                  {candidatePlayers.length > 0 && (
                    <span className="text-xs text-slate-400 font-medium">
                      Select 1 player to DRAFT into {activeTeam.name}
                    </span>
                  )}
                </div>

                {candidatePlayers.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
                    {candidatePlayers.map((player) => (
                      <CandidateCard
                        key={player.playerId}
                        player={player}
                        language={language}
                        onDraft={handleDraftPlayer}
                        isDrafting={isSpinning}
                        disabled={activeTeam.players.length >= 11}
                      />
                    ))}
                  </div>
                ) : (
                  <NoCandidatesCard
                    language={language}
                    onNextDraft={handleNextDraftFree}
                  />
                )}
              </div>
            )}

            {/* Best XI 11/11 Celebration Alert in Draft Tab */}
            {activeTeam.players.length === 11 && (
              <div className="max-w-xl mx-auto bg-gradient-to-r from-amber-500/20 to-emerald-500/20 border border-amber-400/50 rounded-2xl p-5 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-amber-400 text-slate-950 mx-auto flex items-center justify-center font-black text-2xl shadow-lg">
                  🏆
                </div>
                <h3 className="font-heading font-black text-xl text-white">
                  {t.teamCompletedBanner}
                </h3>
                <p className="text-xs text-slate-300">
                  {t.teamCompletedBannerDesc}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => {
                      soundManager.playButtonClick();
                      setSharingTeam(activeTeam);
                    }}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-heading font-black text-xs tracking-wider shadow-lg flex items-center justify-center gap-1.5 transition-transform hover:scale-105"
                  >
                    <Share2 className="w-3.5 h-3.5 stroke-[3]" />
                    <span>{t.shareTeam}</span>
                  </button>
                  <button
                    onClick={() => {
                      soundManager.playButtonClick();
                      setCurrentView('team');
                    }}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-colors"
                  >
                    {t.viewTeam}
                  </button>
                  <button
                    onClick={() => {
                      soundManager.playButtonClick();
                      handleCreateNewTeam();
                    }}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-heading font-black text-xs tracking-wider border border-amber-500/30 transition-colors"
                  >
                    {t.createNewTeam} (TEAM {teams.length + 1})
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: MY TEAM & TACTICAL PITCH */}
        {currentView === 'team' && (
          <PitchView
            teams={teams}
            activeTeamId={activeTeam.teamId}
            defenseSquadId={defenseSquadId}
            onSetDefenseSquad={handleSetDefenseSquad}
            onSelectTeam={handleSelectTeam}
            onCreateNewTeam={handleCreateNewTeam}
            onDeleteTeam={handleDeleteTeam}
            onContinueDraft={handleContinueDraft}
            onOpenShare={(teamToShare) => setSharingTeam(teamToShare)}
            myTeam={activeTeam.players}
            playerSlots={activeTeam.playerSlots}
            onUpdateSlotAssignment={(newSlots) => {
              updateActiveTeam((prev) => ({ ...prev, playerSlots: newSlots }));
            }}
            formation={activeTeam.formation}
            onChangeFormation={(newFormation) => {
              updateActiveTeam((prev) => {
                const newSlots = remapPlayerSlots(
                  prev.players,
                  prev.playerSlots,
                  newFormation,
                  prev.formation
                );
                return {
                  ...prev,
                  formation: newFormation,
                  playerSlots: newSlots,
                  customPositions: newFormation === 'CUSTOM' ? prev.customPositions : {},
                };
              });
            }}
            customPositions={activeTeam.customPositions}
            onUpdateCustomPositions={(newPos) => {
              updateActiveTeam((prev) => ({ ...prev, customPositions: newPos }));
            }}
            isLocked={activeTeam.isLocked}
            onToggleLock={handleToggleTeamLock}
            language={language}
          />
        )}

        {/* VIEW 4: DRAFT HISTORY */}
        {currentView === 'history' && (
          <div className="max-w-3xl mx-auto">
            <HistoryModal
              isOpen={true}
              onClose={() => setCurrentView('home')}
              history={draftHistory}
              language={language}
              onClearHistory={handleClearHistory}
              onDeleteEntry={handleDeleteHistoryEntry}
            />
          </div>
        )}

        {/* VIEW 5: ONLINE PvP BATTLE (BETA) */}
        {currentView === 'pvp' && (
          <PvPView
            activeTeam={activeTeam}
            teams={teams}
            language={language}
            onBackToDraft={() => setCurrentView('draft')}
            onNavigate={(tab) => setCurrentView(tab)}
            onOpenSyncDebug={() => setIsSyncDebugOpen(true)}
          />
        )}
      </main>

      {/* Gift Box Modal */}
      <GiftBoxModal
        isOpen={isGiftBoxOpen}
        onClose={() => setIsGiftBoxOpen(false)}
        presents={Array.isArray(presents) ? presents : []}
        onClaimItem={handleClaimGift}
        onClaimAll={handleClaimAllGifts}
        onOpenScoutModal={() => {
          setIsGiftBoxOpen(false);
          setIsRewardScoutOpen(true);
        }}
        language={language}
      />

      {/* Reward Scout Modal */}
      <RewardScoutModal
        isOpen={isRewardScoutOpen}
        onClose={() => setIsRewardScoutOpen(false)}
        language={language}
        activeTeam={activeTeam}
        onOpenGiftBox={() => {
          setIsRewardScoutOpen(false);
          setIsGiftBoxOpen(true);
        }}
        onAcquirePlayer={handleAcquireScoutPlayer}
      />

      {/* Mode Select Modal (Pop-up on "PLAY / SPIN DRAFT" or mode change) */}
      <ModeSelectModal
        isOpen={isModeSelectOpen}
        onClose={() => setIsModeSelectOpen(false)}
        currentMode={mode}
        onSelectMode={(selectedMode) => {
          handleSelectMode(selectedMode);
          setCurrentView('draft');
        }}
        language={language}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        language={language}
        onLanguageChange={handleLanguageChange}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onResetGame={handleResetGame}
        xCharLimit={xCharLimit}
        onXCharLimitChange={(limit) => setXCharLimit(limit)}
        onOpenUpdateNotes={() => {
          setIsSettingsOpen(false);
          setIsUpdateNotesOpen(true);
        }}
      />

      {/* How To Play Modal */}
      <HowToPlayModal
        isOpen={isHowToPlayOpen}
        onClose={() => setIsHowToPlayOpen(false)}
        language={language}
      />

      {/* Update Notes Modal */}
      <UpdateNotesModal
        isOpen={isUpdateNotesOpen}
        onClose={() => setIsUpdateNotesOpen(false)}
        language={language}
      />

      {/* Celebration Modal (When team finishes 11/11 players) */}
      {celebratingTeam && (
        <CelebrationModal
          isOpen={!!celebratingTeam}
          onClose={() => setCelebratingTeam(null)}
          team={celebratingTeam}
          language={language}
          onShareTeam={() => {
            const target = celebratingTeam;
            setCelebratingTeam(null);
            setSharingTeam(target);
          }}
          onViewTeam={() => {
            setCelebratingTeam(null);
            setCurrentView('team');
          }}
          onCreateNewTeam={() => {
            setCelebratingTeam(null);
            handleCreateNewTeam();
          }}
        />
      )}

      {/* SNS Share Modal */}
      {sharingTeam && (
        <ShareModal
          isOpen={!!sharingTeam}
          onClose={() => setSharingTeam(null)}
          team={sharingTeam}
          language={language}
          xCharLimit={xCharLimit}
        />
      )}

      {/* Online Sync Debug & Health Monitor Modal */}
      <OnlineSyncDebugModal
        isOpen={isSyncDebugOpen}
        onClose={() => setIsSyncDebugOpen(false)}
      />

      {/* Footer */}
      <footer className="mt-auto py-4 border-t border-slate-900 bg-slate-950/80 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <span>⚽ FOOTBALL DRAFT — Authentic Real Players Database</span>
            <button
              onClick={() => setIsUpdateNotesOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold hover:bg-emerald-500/20 transition-colors cursor-pointer"
            >
              <span>{CURRENT_VERSION}</span>
              <span>•</span>
              <span className="underline">UPDATE NOTES</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentView('home')}
              className="text-slate-400 hover:text-emerald-400 transition-colors"
            >
              {t.home}
            </button>
            <span>•</span>
            <button
              onClick={() => setIsHowToPlayOpen(true)}
              className="text-slate-400 hover:text-emerald-400 transition-colors"
            >
              {t.howToPlay}
            </button>
            <span>•</span>
            <button
              onClick={() => setIsHistoryOpen(true)}
              className="text-slate-400 hover:text-emerald-400 transition-colors"
            >
              {t.history} ({draftHistory.length})
            </button>
          </div>
        </div>
      </footer>

      {/* Pop-up History Modal triggered from footer */}
      {isHistoryOpen && (
        <HistoryModal
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          history={draftHistory}
          language={language}
          onClearHistory={handleClearHistory}
          onDeleteEntry={handleDeleteHistoryEntry}
        />
      )}
    </div>
  );
}
