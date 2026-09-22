import React, { useState, useEffect, useRef } from 'react';
import {
  UserTeam,
  Language,
  BetaUserProfile,
  BetaMatchRecord,
  BetaMatchEvent,
  BetaStandingEntry,
  TeamTactics,
  AttackTactics,
  DefenseTactics,
} from '../types';
import {
  getCurrentUserProfile,
  simulateOVRMatch,
  simulateTacticalMatchHalf,
  computeWeeklyStandings,
  DEFAULT_TACTICS,
  calculateOVRMatchOdds,
} from '../utils/pvpEngine';
import { getTeamEffectiveOvr } from '../utils/positionEngine';
import { getTeamFormationDisplayName } from '../utils/formationUtils';
import {
  getCurrentSeasonInfo,
  getSeasonInfo,
  formatSeasonPeriod,
  getHistoricalSeasons,
  isSeasonInAggregationPhase,
  isSeasonFinalized,
} from '../utils/seasonEngine';
import { getStoredPastRankings, distributeWeeklyRewardsForWeek } from '../utils/rewardScoutEngine';
import {
  initSupabasePvP,
  registerOrUpdateUserInSupabase,
  saveBestXIToSupabase,
  fetchOnlineUsersFromSupabase,
  fetchAllRegisteredUsersFromSupabase,
  searchUsersFromSupabase,
  fetchOpponentBestXIFromSupabase,
  saveMatchRecordToSupabase,
  fetchMatchHistoryFromSupabase,
  fetchWeeklyStandingsFromSupabase,
  fetchWeeklyStandingsWithSyncInfo,
  fetchMatchedOpponentsThisWeek,
  WeeklyMatchedOpponentsMap,
  syncPendingLocalMatchesToServer,
  StandingsSyncInfo,
  checkAndPerformV113Migration,
  migrateLocalStorageToSupabase,
  saveMyManualRankingPreset,
  subscribeToMatchUpdates,
} from '../utils/supabasePvP';
import {
  subscribeToSyncStatus,
  performFullOnlineSync,
  getSyncManagerStatus,
  SyncManagerStatus,
} from '../utils/onlineSyncManager';
import { soundManager } from '../utils/audio';
import confetti from 'canvas-confetti';
import {
  Swords,
  Shield,
  Zap,
  Users,
  Trophy,
  History,
  Search,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCcw,
  Sliders,
  ChevronRight,
  Flame,
  ArrowRight,
  Sparkles,
  Lock,
  Wifi,
  WifiOff,
  Cloud,
  RefreshCw,
  Calendar,
  Clock,
  Medal,
  Award,
  FastForward,
  Database,
} from 'lucide-react';

interface PvPViewProps {
  activeTeam: UserTeam;
  teams?: UserTeam[];
  language: Language;
  onBackToDraft?: () => void;
  onNavigate?: (tab: 'home' | 'draft' | 'team' | 'history' | 'pvp') => void;
  onOpenSyncDebug?: () => void;
}

type PvPTab = 'lobby' | 'tactics' | 'friends' | 'standings' | 'history';

function formatRelativeTime(timestamp: number, lang: Language): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (lang === 'ja') {
    if (seconds < 60) return 'たった今';
    if (minutes < 60) return `${minutes}分前`;
    if (hours < 24) return `${hours}時間前`;
    return `${days}日前`;
  } else {
    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    return `${days} d ago`;
  }
}

export const PvPView: React.FC<PvPViewProps> = ({
  activeTeam,
  teams = [activeTeam],
  language,
  onBackToDraft,
  onNavigate,
  onOpenSyncDebug,
}) => {
  const [activeTab, setActiveTab] = useState<PvPTab>('lobby');

  // User Profile State
  const [userProfile, setUserProfile] = useState<BetaUserProfile>(() =>
    getCurrentUserProfile(activeTeam, teams)
  );
  const [usernameInput, setUsernameInput] = useState(userProfile.username || '');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [isSavingBestXI, setIsSavingBestXI] = useState(false);
  const [bestXISuccess, setBestXISuccess] = useState(false);

  // Tactics State
  const [tactics, setTactics] = useState<TeamTactics>(userProfile.tactics || DEFAULT_TACTICS);

  // Community Users & Online Presence from Supabase
  const [onlineUsers, setOnlineUsers] = useState<BetaUserProfile[]>([]);
  const [allRegisteredUsers, setAllRegisteredUsers] = useState<BetaUserProfile[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState<boolean>(false);

  // User Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BetaUserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Sync user profile with active team and defense squad configurations
  useEffect(() => {
    setUserProfile(getCurrentUserProfile(activeTeam, teams));
  }, [activeTeam, teams]);

  // Pre-Match Confirmation & Squad Selection State
  const [isPreMatchOpen, setIsPreMatchOpen] = useState<boolean>(false);
  const [preMatchOpponent, setPreMatchOpponent] = useState<BetaUserProfile | null>(null);
  const [preMatchMode, setPreMatchMode] = useState<'OVR' | 'TACTICAL'>('OVR');
  const [preMatchCategory, setPreMatchCategory] = useState<'REALTIME' | 'ASYNC'>('ASYNC');
  const [selectedPlayingSquadId, setSelectedPlayingSquadId] = useState<string>(activeTeam.teamId);
  const [isLoadingOpponentTeam, setIsLoadingOpponentTeam] = useState(false);

  // Derive the actively selected playing squad
  const activePlayingSquad =
    teams.find((t) => t.teamId === selectedPlayingSquadId) || activeTeam;

  // Match Simulation State
  const [activeOpponent, setActiveOpponent] = useState<BetaUserProfile | null>(null);
  const [currentPlayingSquad, setCurrentPlayingSquad] = useState<UserTeam>(activeTeam);
  const [matchMode, setMatchMode] = useState<'OVR' | 'TACTICAL' | null>(null);
  const [matchCategory, setMatchCategory] = useState<'REALTIME' | 'ASYNC'>('ASYNC');
  const [isMatchRunning, setIsMatchRunning] = useState(false);
  const [matchPhase, setMatchPhase] = useState<'1st_half' | 'halftime' | '2nd_half' | 'finished'>('1st_half');
  const [matchTimerSeconds, setMatchTimerSeconds] = useState<number>(0);
  const [currentScore, setCurrentScore] = useState<[number, number]>([0, 0]);
  const [liveEvents, setLiveEvents] = useState<BetaMatchEvent[]>([]);
  const [finalMatchRecord, setFinalMatchRecord] = useState<BetaMatchRecord | null>(null);

  // Match History
  const [matchHistory, setMatchHistory] = useState<BetaMatchRecord[]>([]);

  // Weekly Season & Standings State
  const currentSeasonInfo = getCurrentSeasonInfo();
  const [selectedSeason, setSelectedSeason] = useState<number>(currentSeasonInfo.seasonNumber);
  const [standingsFilter, setStandingsFilter] = useState<'ALL' | 'OVR' | 'TACTICAL'>('ALL');
  const [weeklyStandings, setWeeklyStandings] = useState<BetaStandingEntry[]>([]);
  const [isLoadingStandings, setIsLoadingStandings] = useState<boolean>(false);
  const [standingsNotice, setStandingsNotice] = useState<string | null>(null);

  // 10-minute periodic online synchronization state manager
  const [syncStatus, setSyncStatus] = useState<SyncManagerStatus>(getSyncManagerStatus());
  const [syncMetadata, setSyncMetadata] = useState<StandingsSyncInfo | null>(null);

  useEffect(() => {
    const unsub = subscribeToSyncStatus((status) => {
      setSyncStatus(status);
      if (status.state === 'SUCCESS') {
        loadStandingsData(selectedSeason, standingsFilter);
        fetchMatchHistoryFromSupabase(userProfile.userId).then((hist) => setMatchHistory(hist));
      }
    });
    return unsub;
  }, [selectedSeason, standingsFilter, userProfile.userId]);

  // Opponents matched in the current week per mode (1 match per week per mode: OVR and TACTICAL each 1 match per week, bidirectional)
  const [weeklyMatchedOpponents, setWeeklyMatchedOpponents] = useState<WeeklyMatchedOpponentsMap>({
    ovr: [],
    tactical: [],
    all: [],
  });
  const [matchLimitToast, setMatchLimitToast] = useState<string | null>(null);

  // Helper: check if opponent already played against in current week per mode ('OVR' or 'TACTICAL')
  const isOpponentMatchedInPhase = (oppUserId: string, mode?: 'OVR' | 'TACTICAL'): boolean => {
    if (!oppUserId || oppUserId === userProfile.userId) return false;

    if (mode === 'OVR') {
      if (weeklyMatchedOpponents.ovr.includes(oppUserId)) return true;
      return matchHistory.some((m) => {
        const matchInWeek =
          m.weekId === currentSeasonInfo.weekId ||
          m.season === currentSeasonInfo.seasonNumber ||
          (!m.season && !m.weekId);
        const isPair =
          (m.challengerUserId === userProfile.userId && m.opponentUserId === oppUserId) ||
          (m.opponentUserId === userProfile.userId && m.challengerUserId === oppUserId);
        const isOvr = !String(m.matchType || '').toUpperCase().includes('TACTICAL');
        return matchInWeek && isPair && isOvr;
      });
    }

    if (mode === 'TACTICAL') {
      if (weeklyMatchedOpponents.tactical.includes(oppUserId)) return true;
      return matchHistory.some((m) => {
        const matchInWeek =
          m.weekId === currentSeasonInfo.weekId ||
          m.season === currentSeasonInfo.seasonNumber ||
          (!m.season && !m.weekId);
        const isPair =
          (m.challengerUserId === userProfile.userId && m.opponentUserId === oppUserId) ||
          (m.opponentUserId === userProfile.userId && m.challengerUserId === oppUserId);
        const isTactical = String(m.matchType || '').toUpperCase().includes('TACTICAL');
        return matchInWeek && isPair && isTactical;
      });
    }

    // When mode is omitted: return true only if BOTH OVR and TACTICAL have been matched
    return isOpponentMatchedInPhase(oppUserId, 'OVR') && isOpponentMatchedInPhase(oppUserId, 'TACTICAL');
  };

  // Halftime modified tactics
  const [halftimeTactics, setHalftimeTactics] = useState<TeamTactics>(tactics);

  const simulationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Supabase PvP connection & Presence and perform v1.1.3 migration
  useEffect(() => {
    checkAndPerformV113Migration();

    initSupabasePvP(
      userProfile,
      (liveOnline) => {
        setOnlineUsers(liveOnline);
      },
      (invite) => {
        console.log('Received match invite:', invite);
      }
    );

    refreshCommunityData(selectedSeason);
  }, [userProfile.userId, userProfile.username]);

  // Refresh Online and Registered Users, Match History, and Weekly Matched Opponents from Supabase / Server
  const refreshCommunityData = async (seasonToLoad = selectedSeason) => {
    setIsLoadingUsers(true);
    try {
      const [online, all, hist, matchedMap] = await Promise.all([
        fetchOnlineUsersFromSupabase(userProfile.userId),
        fetchAllRegisteredUsersFromSupabase(userProfile.userId),
        fetchMatchHistoryFromSupabase(userProfile.userId),
        fetchMatchedOpponentsThisWeek(userProfile.userId, currentSeasonInfo.weekId),
      ]);
      setOnlineUsers(online);
      setAllRegisteredUsers(all);
      setMatchHistory(hist);
      if (matchedMap) {
        setWeeklyMatchedOpponents(matchedMap);
      }
      loadStandingsData(seasonToLoad, standingsFilter, all, hist);
    } catch (e) {
      console.warn('Failed to refresh Supabase PvP data', e);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  // Load Weekly Standings from Supabase / Server with 15-minute sync cycle
  const loadStandingsData = async (
    season: number,
    filter: 'ALL' | 'OVR' | 'TACTICAL',
    knownUsers = allRegisteredUsers,
    knownHistory = matchHistory
  ) => {
    setIsLoadingStandings(true);
    try {
      // 1. Ensure any locally cached matches are pushed to server authority first
      await syncPendingLocalMatchesToServer();

      // 2. Fetch authoritative rankings along with 10-minute cycle metadata
      const info = await fetchWeeklyStandingsWithSyncInfo(season, filter, userProfile);
      if (info && info.standings && info.standings.length > 0) {
        setWeeklyStandings(info.standings);
        setSyncMetadata(info);
      } else {
        const fallback = computeWeeklyStandings(knownUsers, userProfile, knownHistory, season, filter);
        setWeeklyStandings(fallback);
      }
    } catch (e) {
      console.warn('Failed to fetch weekly standings', e);
      const fallback = computeWeeklyStandings(knownUsers, userProfile, knownHistory, season, filter);
      setWeeklyStandings(fallback);
    } finally {
      setIsLoadingStandings(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);

    if (params.get('setMyRanking') !== '1') {
      return;
    }

    const storageKey =
      `YOUOTSUNE_RANKING_PRESET_` +
      `${currentSeasonInfo.weekId}_` +
      `${userProfile.userId}`;

    if (localStorage.getItem(storageKey) === 'done') {
      return;
    }

    let cancelled = false;

    (async () => {
      const result = await saveMyManualRankingPreset(userProfile);

      if (cancelled) return;

      if (result.success) {
        localStorage.setItem(storageKey, 'done');

        setStandingsNotice(
          'OVR・戦術ランキング成績をオンラインに保存しました'
        );

        await loadStandingsData(
          selectedSeason,
          standingsFilter
        );

        const url = new URL(window.location.href);
        url.searchParams.delete('setMyRanking');

        window.history.replaceState(
          {},
          '',
          url.toString()
        );
      } else {
        setStandingsNotice(
          `ランキング保存失敗: ${
            result.error || 'unknown'
          }`
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    userProfile.userId,
    currentSeasonInfo.weekId,
  ]);
  // Re-fetch standings when season, filter or tab changes
  useEffect(() => {
    if (activeTab === 'standings') {
      loadStandingsData(selectedSeason, standingsFilter);
    }
  }, [activeTab, selectedSeason, standingsFilter]);

  // Live Supabase Realtime synchronization and event notifications
  useEffect(() => {
    const unsubscribe = subscribeToMatchUpdates(() => {
      loadStandingsData(selectedSeason, standingsFilter);
      fetchMatchHistoryFromSupabase(userProfile.userId).then((hist) => setMatchHistory(hist));
    });

    return () => {
      unsubscribe();
    };
  }, [selectedSeason, standingsFilter, userProfile.userId]);

  // Check and execute automatic reward distribution when season is finalized
  useEffect(() => {
    const seasonInfo = getSeasonInfo(selectedSeason);
    if (seasonInfo.phase === 'FINALIZED' && weeklyStandings.length > 0) {
      distributeWeeklyRewardsForWeek(seasonInfo.weekId, selectedSeason, weeklyStandings);
    }
  }, [selectedSeason, weeklyStandings]);

  // Register / Save Username to Supabase
  const handleSaveUsername = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setUsernameError(null);
    setUsernameSuccess(false);

    const trimmed = usernameInput.trim();
    if (!trimmed || trimmed.length < 3) {
      setUsernameError('ユーザーネームは3文字以上で入力してください。');
      return;
    }

    setIsSavingUser(true);
    const updatedProfile: BetaUserProfile = {
      ...userProfile,
      username: trimmed,
      team: activePlayingSquad,
      tactics,
      updatedAt: Date.now(),
      isOnline: true,
    };

    const res = await registerOrUpdateUserInSupabase(updatedProfile);
    setIsSavingUser(false);

    if (!res.success) {
      setUsernameError(res.error || '保存に失敗しました。');
      soundManager.playButtonClick();
    } else {
      setUserProfile(updatedProfile);
      setUsernameSuccess(true);
      soundManager.playDraftAcquired();
      setTimeout(() => setUsernameSuccess(false), 4000);
      refreshCommunityData(selectedSeason);
    }
  };

  // Save Best XI Team to Supabase
  const handleSaveBestXICloud = async () => {
    if (!userProfile.username) {
      setUsernameError('Best XIを保存する前に、まずPvPユーザーネームを登録してください。');
      return;
    }

    setIsSavingBestXI(true);
    const res = await saveBestXIToSupabase(userProfile, activePlayingSquad, tactics);
    setIsSavingBestXI(false);

    if (res.success) {
      setBestXISuccess(true);
      soundManager.playTeamCompleted();
      setTimeout(() => setBestXISuccess(false), 4000);
      refreshCommunityData(selectedSeason);
    }
  };

  // Save tactics
  const handleSaveTactics = async (newTactics: TeamTactics) => {
    setTactics(newTactics);
    setHalftimeTactics(newTactics);
    const updatedProfile: BetaUserProfile = {
      ...userProfile,
      tactics: newTactics,
      team: activePlayingSquad,
    };
    setUserProfile(updatedProfile);
    soundManager.playButtonClick();

    if (userProfile.username) {
      await saveBestXIToSupabase(updatedProfile, activePlayingSquad, newTactics);
    }
  };

  // Migrate Local Data to Supabase Cloud
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<string | null>(null);

  const handleMigrateToCloud = async () => {
    setIsMigrating(true);
    setMigrationStatus(null);
    soundManager.playButtonClick();
    try {
      const res = await migrateLocalStorageToSupabase(userProfile, teams);
      setMigrationStatus(res.message);
      if (res.success) {
        soundManager.playTeamCompleted();
        refreshCommunityData(selectedSeason);
      }
    } catch (e: any) {
      setMigrationStatus('移行エラー: ' + (e?.message || '通信失敗'));
    } finally {
      setIsMigrating(false);
      setTimeout(() => setMigrationStatus(null), 8000);
    }
  };

  // Search real users in Supabase
  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (!q.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      const results = await searchUsersFromSupabase(q, userProfile.userId);
      setSearchResults(results);
      setIsSearching(false);
    }, 250);
  };

  // Open Pre-Match Confirmation Screen
  const handleOpenPreMatch = async (
    opponent: BetaUserProfile,
    mode: 'OVR' | 'TACTICAL',
    category?: 'REALTIME' | 'ASYNC'
  ) => {
    let activeProfile = userProfile;
    if (!userProfile.username) {
      const fallbackName = `Manager_${userProfile.userId.slice(-4)}`;
      activeProfile = { ...userProfile, username: fallbackName };
      setUserProfile(activeProfile);
      setUsernameInput(fallbackName);
      try {
        localStorage.setItem('FOOTBALL_DRAFT_PVP_CURRENT_HANDLE_V113', fallbackName);
        registerOrUpdateUserInSupabase(activeProfile);
      } catch (err) {}
    }

    // Check weekly match restriction per mode (OVR & TACTICAL each 1 match per week between the same two users)
    if (isOpponentMatchedInPhase(opponent.userId, mode)) {
      const modeText = mode === 'OVR' ? 'OVR対戦' : '戦術対戦';
      const otherModeText = mode === 'OVR' ? '戦術対戦' : 'OVR対戦';
      const otherModeKey = mode === 'OVR' ? 'TACTICAL' : 'OVR';
      const otherMatched = isOpponentMatchedInPhase(opponent.userId, otherModeKey);
      setMatchLimitToast(
        `@${opponent.username || '対戦相手'} とは今週のシーズン（${currentSeasonInfo.formattedRange}）で【${modeText}】をすでに対戦済みです。同じ相手とはOVR対戦と戦術対戦を週に各1回ずつ対戦可能です。${
          otherMatched
            ? '（今週は両モードとも対戦済みです。来週月曜0:00 JSTに再戦可能になります）'
            : `（※【${otherModeText}】は今週まだ対戦可能です！）`
        }`
      );
      setTimeout(() => setMatchLimitToast(null), 7000);
      return;
    }

    soundManager.playButtonClick();
    setIsLoadingOpponentTeam(true);

    const isOppOnline = onlineUsers.some((u) => u.userId === opponent.userId);
    const chosenCategory = category || (isOppOnline ? 'REALTIME' : 'ASYNC');

    // Fetch opponent's saved Best XI from Supabase if not loaded
    let fullOpponent = opponent;
    if (!opponent.team || !opponent.team.players || opponent.team.players.length === 0) {
      const fetchedTeam = await fetchOpponentBestXIFromSupabase(opponent.userId);
      if (fetchedTeam) {
        fullOpponent = { ...opponent, team: fetchedTeam };
      }
    }

    setIsLoadingOpponentTeam(false);
    setPreMatchOpponent(fullOpponent);
    setPreMatchMode(mode);
    setPreMatchCategory(chosenCategory);
    setIsPreMatchOpen(true);
  };

  // Instant Skip to OVR Match Results
  const skipToOVRMatchResult = async (recordOverride?: BetaMatchRecord) => {
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current);
      simulationIntervalRef.current = null;
    }
    const rec = recordOverride || finalMatchRecord;
    if (!rec) return;

    setMatchPhase('finished');
    setIsMatchRunning(false);
    setMatchTimerSeconds(30);
    setCurrentScore([rec.challengerScore, rec.opponentScore]);
    setLiveEvents(rec.events);

    setMatchHistory((prev) => {
      if (prev.some((m) => m.id === rec.id)) return prev;
      return [rec, ...prev];
    });

    if (rec.opponentUserId) {
      const isTac = rec.matchType === 'TACTICAL';
      setWeeklyMatchedOpponents((prev) => ({
        ovr: isTac ? prev.ovr : Array.from(new Set([...prev.ovr, rec.opponentUserId])),
        tactical: isTac ? Array.from(new Set([...prev.tactical, rec.opponentUserId])) : prev.tactical,
        all: Array.from(new Set([...prev.all, rec.opponentUserId])),
      }));
    }

    // Save to Supabase & server, then immediately reload standings
    try {
      await saveMatchRecordToSupabase(rec);
    } catch (e) {
      console.warn('Save match note:', e);
    }
    await loadStandingsData(selectedSeason, standingsFilter);

    if (rec.result === 'WIN') {
      soundManager.playTeamCompleted();
      try {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      } catch (err) {}
    } else {
      soundManager.playSlotStop();
    }
  };

  // ─────────────────────────────────────────────────────────────
  // OVR MATCH (30s simulation with Selected Playing Squad)
  // ─────────────────────────────────────────────────────────────
  const startOVRMatch = (
    opponent: BetaUserProfile,
    playingSquad: UserTeam,
    category: 'REALTIME' | 'ASYNC'
  ) => {
    soundManager.playButtonClick();
    setIsPreMatchOpen(false);
    setActiveOpponent(opponent);
    setCurrentPlayingSquad(playingSquad);
    setMatchMode('OVR');
    setMatchCategory(category);
    setIsMatchRunning(true);
    setMatchPhase('1st_half');
    setMatchTimerSeconds(0);
    setCurrentScore([0, 0]);
    setLiveEvents([]);
    setFinalMatchRecord(null);

    const { record, events } = simulateOVRMatch(
      userProfile,
      opponent,
      playingSquad,
      category
    );
    setFinalMatchRecord(record);

    // Schedule all generated events dynamically across the 28-second timeline
    const totalSimSeconds = 28;
    const scheduledEvents = events.map((evt, idx) => {
      let triggerSec = Math.round((evt.minute / 90) * (totalSimSeconds - 4)) + 2;
      if (idx === 0) triggerSec = 1;
      if (idx === events.length - 1) triggerSec = totalSimSeconds;
      return { triggerSec, event: evt, triggered: false };
    });

    let sec = 0;
    simulationIntervalRef.current = setInterval(() => {
      sec++;
      setMatchTimerSeconds(sec);

      // Process any events due at or before this second
      scheduledEvents.forEach((item) => {
        if (!item.triggered && sec >= item.triggerSec) {
          item.triggered = true;
          setLiveEvents((prev) => [...prev, item.event]);

          if (item.event.isChallengerGoal) {
            setCurrentScore((s) => [s[0] + 1, s[1]]);
            soundManager.playGoldenFanfare();
          }
          if (item.event.isOpponentGoal) {
            setCurrentScore((s) => [s[0], s[1] + 1]);
            soundManager.playGoldenFanfare();
          }
        }
      });

      if (sec >= 30) {
        skipToOVRMatchResult(record);
      }
    }, 1000);
  };

  // ─────────────────────────────────────────────────────────────
  // TACTICAL MATCH (40s 1st Half -> Halftime -> 40s 2nd Half)
  // ─────────────────────────────────────────────────────────────
  const startTacticalMatch = (
    opponent: BetaUserProfile,
    playingSquad: UserTeam,
    category: 'REALTIME' | 'ASYNC'
  ) => {
    soundManager.playButtonClick();
    setIsPreMatchOpen(false);
    setActiveOpponent(opponent);
    setCurrentPlayingSquad(playingSquad);
    setMatchMode('TACTICAL');
    setMatchCategory(category);
    setIsMatchRunning(true);
    setMatchPhase('1st_half');
    setMatchTimerSeconds(0);
    setCurrentScore([0, 0]);
    setLiveEvents([]);
    setFinalMatchRecord(null);

    const firstHalfSim = simulateTacticalMatchHalf(
      1,
      userProfile,
      opponent,
      [0, 0],
      tactics,
      playingSquad
    );

    let sec = 0;
    simulationIntervalRef.current = setInterval(() => {
      sec++;
      setMatchTimerSeconds(sec);

      if (sec === 3) {
        setLiveEvents((prev) => [...prev, firstHalfSim.events[0]]);
      } else if (sec === 15) {
        setLiveEvents((prev) => [...prev, firstHalfSim.events[1]]);
      } else if (sec === 28 && firstHalfSim.events[2]) {
        setLiveEvents((prev) => [...prev, firstHalfSim.events[2]]);
        setCurrentScore(firstHalfSim.halfScore);
        if (firstHalfSim.events[2].isChallengerGoal || firstHalfSim.events[2].isOpponentGoal) {
          soundManager.playGoldenFanfare();
        }
      } else if (sec >= 40) {
        if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current);
        setMatchPhase('halftime');
        setIsMatchRunning(false);
        setLiveEvents((prev) => [
          ...prev,
          firstHalfSim.events[firstHalfSim.events.length - 1],
        ]);
        soundManager.playSlotStop();
      }
    }, 1000);
  };

  const resumeSecondHalf = () => {
    if (!activeOpponent) return;
    soundManager.playButtonClick();
    setIsMatchRunning(true);
    setMatchPhase('2nd_half');
    setMatchTimerSeconds(0);

    const secondHalfSim = simulateTacticalMatchHalf(
      2,
      userProfile,
      activeOpponent,
      currentScore,
      halftimeTactics,
      currentPlayingSquad
    );

    let sec = 0;
    simulationIntervalRef.current = setInterval(() => {
      sec++;
      setMatchTimerSeconds(sec);

      if (sec === 3) {
        setLiveEvents((prev) => [...prev, secondHalfSim.events[0]]);
      } else if (sec === 15) {
        setLiveEvents((prev) => [...prev, secondHalfSim.events[1]]);
      } else if (sec === 28 && secondHalfSim.events[2]) {
        setLiveEvents((prev) => [...prev, secondHalfSim.events[2]]);
        setCurrentScore(secondHalfSim.halfScore);
        if (secondHalfSim.events[2].isChallengerGoal || secondHalfSim.events[2].isOpponentGoal) {
          soundManager.playGoldenFanfare();
        }
      } else if (sec >= 40) {
        if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current);
        setMatchPhase('finished');
        setIsMatchRunning(false);
        setLiveEvents((prev) => [
          ...prev,
          secondHalfSim.events[secondHalfSim.events.length - 1],
        ]);

        const fullScore = secondHalfSim.halfScore;
        const res: 'WIN' | 'DRAW' | 'LOSS' =
          fullScore[0] > fullScore[1] ? 'WIN' : fullScore[0] === fullScore[1] ? 'DRAW' : 'LOSS';
        const pts = res === 'WIN' ? 3 : res === 'DRAW' ? 1 : 0;

        const cOvr = getTeamEffectiveOvr(currentPlayingSquad);
        const oOvr = getTeamEffectiveOvr(activeOpponent.team);

        const record: BetaMatchRecord = {
          id: 'tac_match_' + Date.now(),
          challengerUserId: userProfile.userId,
          challengerUsername: userProfile.username || 'You',
          opponentUserId: activeOpponent.userId,
          opponentUsername: activeOpponent.username,
          matchType: 'TACTICAL',
          matchCategory,
          challengerScore: fullScore[0],
          opponentScore: fullScore[1],
          result: res,
          points: pts,
          challengerOvr: cOvr,
          opponentOvr: oOvr,
          challengerTeamName: currentPlayingSquad.name,
          opponentTeamName: activeOpponent.team?.name || 'Defense Squad',
          timestamp: Date.now(),
          season: getCurrentSeasonInfo().seasonNumber,
          events: liveEvents.concat(secondHalfSim.events),
          fullTimeScore: fullScore,
          challengerTactics: halftimeTactics,
          opponentTactics: activeOpponent.tactics,
        };

        setFinalMatchRecord(record);
        setMatchHistory((prev) => [record, ...prev]);
        if (record.opponentUserId) {
          const isTac = record.matchType === 'TACTICAL';
          setWeeklyMatchedOpponents((prev) => ({
            ovr: isTac ? prev.ovr : Array.from(new Set([...prev.ovr, record.opponentUserId])),
            tactical: isTac ? Array.from(new Set([...prev.tactical, record.opponentUserId])) : prev.tactical,
            all: Array.from(new Set([...prev.all, record.opponentUserId])),
          }));
        }
        saveMatchRecordToSupabase(record).finally(() => {
          loadStandingsData(selectedSeason, standingsFilter);
        });

        if (res === 'WIN') {
          soundManager.playTeamCompleted();
          confetti({ particleCount: 140, spread: 90, origin: { y: 0.6 } });
        }
      }
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current);
    };
  }, []);

  // Determine current active team OVR
  const myTeamOvr = activePlayingSquad.players.length
    ? Math.round(
        activePlayingSquad.players.reduce((s, p) => s + p.rating, 0) /
          activePlayingSquad.players.length
      )
    : 85;

  const historicalSeasons = getHistoricalSeasons();
  const selectedSeasonMeta = getSeasonInfo(selectedSeason);

  return (
    <div id="pvp-view-container" className="space-y-6 max-w-5xl mx-auto pb-12 animate-fadeIn">
      {/* 週間対戦制限トースト通知 */}
      {matchLimitToast && (
        <div className="p-4 rounded-2xl bg-amber-950/90 border-2 border-amber-500/70 text-amber-200 text-xs sm:text-sm flex items-start sm:items-center justify-between gap-3 shadow-2xl animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
            <span className="font-medium">{matchLimitToast}</span>
          </div>
          <button
            onClick={() => setMatchLimitToast(null)}
            className="px-2.5 py-1 rounded-lg bg-amber-900/60 hover:bg-amber-800 text-amber-300 text-xs font-bold shrink-0 transition-colors"
          >
            閉じる
          </button>
        </div>
      )}

      {/* Top Banner with Supabase Cloud Status */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 border-2 border-indigo-500/40 rounded-3xl p-5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-xs font-black border border-emerald-500/40 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>SUPABASE ONLINE</span>
              </span>
              <span className="text-xs font-mono text-indigo-300 font-bold">WEEKLY RANKING & ASYNC ENGINE</span>
            </div>
            <h2 className="font-heading font-black text-2xl sm:text-3xl text-white tracking-wide flex items-center gap-2">
              <Swords className="w-7 h-7 text-indigo-400" />
              <span>PvP 対戦＆週間ランキング (v1.2.0)</span>
            </h2>
            <p className="text-xs text-slate-300 max-w-xl">
              Supabaseに登録された実在プレイヤーと対戦！ 毎週月曜0:00〜日曜23:59(JST)の週間ランキングを開催中。
              同じ相手とは【OVR対戦】【戦術対戦】を週に各1回ずつ対戦可能です。
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap sm:flex-nowrap">
            <button
              onClick={handleMigrateToCloud}
              disabled={isMigrating}
              title="端末内（localStorage）のチーム・対戦履歴をSupabaseクラウドへ一括移行"
              className="px-3 py-2 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 font-bold text-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Cloud className={`w-3.5 h-3.5 text-indigo-400 ${isMigrating ? 'animate-bounce' : ''}`} />
              <span>{isMigrating ? '移行中...' : 'クラウド移行'}</span>
            </button>
            <button
              onClick={() => refreshCommunityData(selectedSeason)}
              disabled={isLoadingUsers}
              title="データを更新"
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingUsers ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">更新</span>
            </button>
            <button
              onClick={onBackToDraft}
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
            >
              ← Back to Draft
            </button>
          </div>
        </div>

        {/* User Registration Form & Current Handle Badge */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-300 font-bold text-sm shadow-inner">
              👤
            </div>
            <div>
              <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1.5">
                <span>YOUR PVP HANDLE</span>
                {userProfile.username && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                    <Cloud className="w-3 h-3" />
                    <span>Cloud Synced</span>
                  </span>
                )}
              </div>
              <div className="text-base font-black text-white flex items-center gap-2">
                <span>{userProfile.username ? `@${userProfile.username}` : '(未登録・設定してください)'}</span>
                {userProfile.username && (
                  <span className="text-xs font-mono font-bold text-amber-400 px-2 py-0.5 rounded-md bg-amber-400/10 border border-amber-400/30">
                    OVR {myTeamOvr}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <form onSubmit={handleSaveUsername} className="flex items-center gap-2">
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="ユーザー名 (例: LeoChampion)"
                maxLength={18}
                disabled={isSavingUser}
                className="bg-slate-950 border border-slate-700 focus:border-indigo-400 px-3 py-2 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none w-full sm:w-52 font-medium"
              />
              <button
                type="submit"
                disabled={isSavingUser}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-heading font-black text-xs tracking-wider shadow-md shrink-0 transition-transform active:scale-95 disabled:opacity-50"
              >
                {isSavingUser ? '保存中...' : '登録・保存'}
              </button>
            </form>

            <button
              onClick={handleSaveBestXICloud}
              disabled={isSavingBestXI || !userProfile.username}
              title="現在のBest XIチームをSupabaseに保存して対戦相手に公開します"
              className="px-3.5 py-2 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 text-xs font-bold transition-all flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isSavingBestXI ? '保存中...' : 'Best XI 保存'}</span>
            </button>
          </div>
        </div>

        {usernameError && (
          <div className="mt-3 text-xs text-rose-400 bg-rose-950/40 p-2.5 rounded-xl border border-rose-500/30 flex items-center gap-2 animate-fadeIn">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{usernameError}</span>
          </div>
        )}
        {usernameSuccess && (
          <div className="mt-3 text-xs text-emerald-400 bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-500/30 flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>PvPハンドル「@{userProfile.username}」とチームデータをSupabaseに正常保存しました！</span>
          </div>
        )}
        {bestXISuccess && (
          <div className="mt-3 text-xs text-emerald-400 bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-500/30 flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Best XI（{activePlayingSquad.name} / OVR {myTeamOvr}）をSupabaseクラウドに保存しました！</span>
          </div>
        )}
        {migrationStatus && (
          <div className="mt-3 text-xs text-indigo-300 bg-indigo-950/50 p-2.5 rounded-xl border border-indigo-500/40 flex items-center gap-2 animate-fadeIn">
            <Cloud className="w-4 h-4 shrink-0 text-indigo-400" />
            <span>{migrationStatus}</span>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
        {[
          { id: 'lobby', label: '⚔️ 対戦ロビー', icon: Swords },
          { id: 'tactics', label: '🧠 戦術設定', icon: Sliders },
          { id: 'friends', label: '🔍 ユーザー検索', icon: Search },
          { id: 'standings', label: '🏆 週間ランキング (JST)', icon: Trophy },
          { id: 'history', label: '📜 MATCH HISTORY', icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                soundManager.playButtonClick();
                setActiveTab(tab.id as PvPTab);
              }}
              className={`px-4 py-2.5 rounded-2xl font-heading font-extrabold text-xs tracking-wider flex items-center gap-2 transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* PRE-MATCH CONFIRMATION & SQUAD SELECTION MODAL */}
      {isPreMatchOpen && preMatchOpponent && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-fadeIn">
          <div className="bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border-2 border-indigo-500/60 rounded-3xl p-5 sm:p-7 max-w-4xl w-full shadow-2xl space-y-6 animate-scaleUp my-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono text-xs font-black border border-indigo-500/40">
                    {preMatchMode === 'OVR' ? '⚡ 総合値マッチ (30s)' : '🧠 戦術マッチ (前後半40s)'}
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border ${
                    preMatchCategory === 'REALTIME'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}>
                    {preMatchCategory === 'REALTIME' ? '🟢 REALTIME MATCH' : '⚡ ASYNC MATCH (非同期)'}
                  </span>
                </div>
                <h3 className="font-heading font-black text-xl sm:text-2xl text-white">
                  MATCH PREVIEW (対戦前マッチアップ)
                </h3>
              </div>

              <button
                onClick={() => setIsPreMatchOpen(false)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors text-xs font-bold"
              >
                ✕ 閉じる
              </button>
            </div>

            {/* Matchup Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
              {/* Left Column: Challenger / Your Playing Squad */}
              <div className="lg:col-span-5 bg-slate-900/90 border-2 border-indigo-500/50 rounded-2xl p-4 space-y-3.5 shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-base">👤</span>
                    <div>
                      <div className="text-[10px] font-mono text-indigo-400 font-bold uppercase">
                        YOUR SQUAD (使用スカッド)
                      </div>
                      <div className="font-heading font-black text-sm text-white">
                        @{userProfile.username || 'YOU'}
                      </div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-mono font-bold">
                    CHALLENGER
                  </span>
                </div>

                {/* Squad Selector */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                    <span>使用するスカッドを選択:</span>
                    <span className="text-[10px] font-mono text-slate-400">{teams.length} スカッド</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {teams.map((t) => {
                      const isSelected = t.teamId === activePlayingSquad.teamId;
                      const sOvr = getTeamEffectiveOvr(t);

                      return (
                        <button
                          key={t.teamId}
                          type="button"
                          onClick={() => {
                            soundManager.playButtonClick();
                            setSelectedPlayingSquadId(t.teamId);
                          }}
                          className={`p-2 rounded-xl text-left transition-all border ${
                            isSelected
                              ? 'bg-indigo-600/30 border-indigo-400 text-white shadow-md ring-1 ring-indigo-400'
                              : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-heading font-black text-xs truncate">{t.name}</span>
                            {isSelected && <CheckCircle2 className="w-3 h-3 text-indigo-400 shrink-0" />}
                          </div>
                          <div className="flex items-center justify-between text-[10px] font-mono mt-1 text-slate-400">
                            <span>{getTeamFormationDisplayName(t)}</span>
                            <span className="text-amber-400 font-bold">OVR {sOvr}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Selected Squad OVR and Formation */}
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-slate-400 font-mono">FORMATION</div>
                    <div className="font-bold text-xs text-white">{getTeamFormationDisplayName(activePlayingSquad)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 font-mono">TEAM OVR</div>
                    <div className="font-heading font-black text-base text-amber-400">
                      {getTeamEffectiveOvr(activePlayingSquad)}
                    </div>
                  </div>
                </div>

                {/* Tactics Summary */}
                <div className="text-xs space-y-1 bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] font-mono text-slate-400 uppercase">TACTICS</div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-emerald-400 font-bold">⚽ 攻撃: {tactics.attackTactic}</span>
                    <span className="text-indigo-400 font-bold">🛡️ 守備: {tactics.defenseTactic}</span>
                  </div>
                </div>
              </div>

              {/* VS Emblem */}
              <div className="lg:col-span-2 flex flex-col items-center justify-center py-2 text-center">
                <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-600 to-rose-600 flex items-center justify-center font-heading font-black text-white text-base shadow-lg shadow-rose-900/40">
                  VS
                </div>
                <span className="text-[10px] font-mono text-slate-400 mt-1 uppercase tracking-wider">
                  {preMatchMode} MATCH
                </span>
              </div>

              {/* Right Column: Opponent Designated Defense Squad */}
              <div className="lg:col-span-5 bg-slate-900/90 border-2 border-rose-500/40 rounded-2xl p-4 space-y-3.5 shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🛡️</span>
                    <div>
                      <div className="text-[10px] font-mono text-rose-400 font-bold uppercase">
                        DEFENSE SQUAD (相手守備陣形)
                      </div>
                      <div className="font-heading font-black text-sm text-white">
                        @{preMatchOpponent.username}
                      </div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-mono font-bold">
                    OPPONENT
                  </span>
                </div>

                {/* Opponent Squad Info */}
                {(() => {
                  const oppSquad =
                    preMatchMode === 'OVR'
                      ? preMatchOpponent.ovrDefenseSquad || preMatchOpponent.team
                      : preMatchOpponent.tacticalDefenseSquad || preMatchOpponent.team;
                  return (
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                          <span>{preMatchMode === 'OVR' ? '⚡ OVR守備スカッド' : '🧠 戦術守備スカッド'}</span>
                        </div>
                        <div className="font-bold text-xs text-white truncate max-w-[140px]">
                          {oppSquad?.name || 'Defense Squad'}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {getTeamFormationDisplayName(oppSquad)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 font-mono">DEFENSE OVR</div>
                        <div className="font-heading font-black text-base text-amber-400">
                          {getTeamEffectiveOvr(oppSquad)}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Opponent Tactics Summary */}
                <div className="text-xs space-y-1 bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] font-mono text-slate-400 uppercase">SET TACTICS</div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-emerald-400 font-bold">
                      ⚽ {preMatchOpponent.tactics?.attackTactic || 'POSSESSION'}
                    </span>
                    <span className="text-indigo-400 font-bold">
                      🛡️ {preMatchOpponent.tactics?.defenseTactic || 'MID_BLOCK'}
                    </span>
                  </div>
                </div>

                {/* Opponent Players preview */}
                <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1">
                  <span>登録選手数: {preMatchOpponent.team?.players?.length || 11} 名</span>
                  <span className="text-emerald-400 font-bold">
                    {onlineUsers.some((u) => u.userId === preMatchOpponent.userId) ? '🟢 相手オンライン' : '⚫ 非同期対戦'}
                  </span>
                </div>
              </div>
            </div>

            {/* OVR Odds Card (when OVR mode) */}
            {(() => {
              const myOvr = getTeamEffectiveOvr(activePlayingSquad);
              const oppOvr = getTeamEffectiveOvr(preMatchOpponent.team);
              const ovrOdds = calculateOVRMatchOdds(myOvr, oppOvr);
              const isAlreadyMatched = isOpponentMatchedInPhase(preMatchOpponent.userId, preMatchMode);
              const isSquadIncomplete = (activePlayingSquad.players?.length || 0) < 11;

              return (
                <div className="space-y-3 pt-1">
                  {preMatchMode === 'OVR' && (
                    <div className="p-3.5 rounded-2xl bg-slate-950 border border-indigo-500/40 space-y-2 shadow-inner">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-slate-200 font-bold flex items-center gap-1.5">
                          📊 <span>勝率予想 (OVR MATCH ODDS)</span>
                        </span>
                        <span className="text-slate-400 text-[10px]">
                          OVR差: {myOvr - oppOvr > 0 ? `+${myOvr - oppOvr}` : `${myOvr - oppOvr}`}
                        </span>
                      </div>

                      {/* Segmented Odds Bar */}
                      <div className="h-4 rounded-full overflow-hidden flex bg-slate-900 border border-slate-800 shadow-sm">
                        <div
                          style={{ width: `${ovrOdds.winPct}%` }}
                          className="bg-emerald-500 flex items-center justify-center text-[9px] font-black text-slate-950 font-mono transition-all"
                          title={`勝利予想: ${ovrOdds.winPct}%`}
                        >
                          {ovrOdds.winPct >= 15 ? `${ovrOdds.winPct}%` : ''}
                        </div>
                        <div
                          style={{ width: `${ovrOdds.drawPct}%` }}
                          className="bg-slate-500 flex items-center justify-center text-[9px] font-black text-white font-mono transition-all"
                          title={`引分予想: ${ovrOdds.drawPct}%`}
                        >
                          {ovrOdds.drawPct >= 12 ? `${ovrOdds.drawPct}%` : ''}
                        </div>
                        <div
                          style={{ width: `${ovrOdds.lossPct}%` }}
                          className="bg-rose-500 flex items-center justify-center text-[9px] font-black text-slate-950 font-mono transition-all"
                          title={`敗北予想: ${ovrOdds.lossPct}%`}
                        >
                          {ovrOdds.lossPct >= 15 ? `${ovrOdds.lossPct}%` : ''}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-mono font-bold">
                        <span className="text-emerald-400">勝利 {ovrOdds.winPct}%</span>
                        <span className="text-slate-400">引分 {ovrOdds.drawPct}%</span>
                        <span className="text-rose-400">敗北 {ovrOdds.lossPct}%</span>
                      </div>
                      <div className="text-[9px] text-slate-400 text-center">
                        ※ 総合値差に応じた確率制マッチ。総合値が劣っていてもアップセット(番狂わせ)の可能性が存在します。
                      </div>
                    </div>
                  )}

                  {/* Squad Incomplete Alert (11-player requirement) */}
                  {isSquadIncomplete && (
                    <div className="p-3.5 rounded-2xl bg-rose-950/60 border-2 border-rose-500/50 text-rose-300 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fadeIn shadow-lg">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
                        <div>
                          <div className="font-heading font-black text-rose-200">
                            対戦不可: 11人揃っていないチームでは対戦できません
                          </div>
                          <div className="text-[11px] text-rose-300/90 mt-0.5">
                            現在の使用スカッド人数: <strong className="text-white">{activePlayingSquad.players?.length || 0} / 11名</strong>。ドラフトで11人獲得してください。
                          </div>
                        </div>
                      </div>
                      {onBackToDraft && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsPreMatchOpen(false);
                            onBackToDraft();
                          }}
                          className="px-3.5 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 font-heading font-black text-xs whitespace-nowrap shadow-md cursor-pointer transition-transform active:scale-95 shrink-0"
                        >
                          ドラフトで揃える →
                        </button>
                      )}
                    </div>
                  )}

                  {/* Duplicate Match Warning in Same Week for this mode */}
                  {!isSquadIncomplete && isAlreadyMatched && (
                    <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2.5 animate-fadeIn">
                      <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        <strong>対戦済み (WEEKLY LIMIT):</strong> @{preMatchOpponent.username} とは今週のシーズン（{currentSeasonInfo.formattedRange}）ですでに【{preMatchMode === 'OVR' ? 'OVR対戦' : '戦術対戦'}】を行っています。OVR対戦と戦術対戦はそれぞれ週1回ずつ対戦可能です。{
                          isOpponentMatchedInPhase(preMatchOpponent.userId, preMatchMode === 'OVR' ? 'TACTICAL' : 'OVR')
                            ? '（今週は両モードとも対戦済みです。来週月曜0:00 JSTに再戦可能になります）'
                            : `（※【${preMatchMode === 'OVR' ? '戦術対戦' : 'OVR対戦'}】は今週まだ対戦可能です！）`
                        }
                      </span>
                    </div>
                  )}

                  {/* Kick Off Button */}
                  <div>
                    <button
                      id="btn-confirm-kickoff"
                      disabled={isSquadIncomplete || isAlreadyMatched}
                      onClick={() => {
                        if (isSquadIncomplete || isAlreadyMatched) return;
                        if (preMatchMode === 'OVR') {
                          startOVRMatch(preMatchOpponent, activePlayingSquad, preMatchCategory);
                        } else {
                          startTacticalMatch(preMatchOpponent, activePlayingSquad, preMatchCategory);
                        }
                      }}
                      className={`w-full py-3.5 rounded-2xl font-heading font-black text-base tracking-wider flex items-center justify-center gap-2 transition-all ${
                        isSquadIncomplete
                          ? 'bg-rose-950/40 text-rose-400 border border-rose-800/60 cursor-not-allowed'
                          : isAlreadyMatched
                          ? 'bg-slate-800/80 text-slate-500 border border-slate-700 cursor-not-allowed'
                          : 'bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-xl shadow-emerald-500/20 transform active:scale-95 cursor-pointer'
                      }`}
                    >
                      {isSquadIncomplete ? (
                        <>
                          <AlertCircle className="w-5 h-5 text-rose-400" />
                          <span>対戦不可 (11人揃えてください: {activePlayingSquad.players?.length || 0}/11)</span>
                        </>
                      ) : isAlreadyMatched ? (
                        <>
                          <CheckCircle2 className="w-5 h-5 text-slate-500" />
                          <span>今週【{preMatchMode === 'OVR' ? 'OVR対戦' : '戦術対戦'}】対戦済み (各週1回制限)</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-5 h-5 fill-slate-950" />
                          <span>KICK OFF (試合開始)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ACTIVE MATCH SIMULATION SCREEN */}
      {matchMode && activeOpponent && (
        <div className="bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border-2 border-indigo-500/50 rounded-3xl p-6 space-y-6 shadow-2xl animate-scaleUp">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono text-xs font-black border border-indigo-500/40">
                {matchMode === 'OVR' ? '⚡ 総合値マッチ (30s)' : '🧠 戦術マッチ'}
              </span>
              <span className="text-xs font-mono text-slate-400">
                {matchPhase === '1st_half'
                  ? '前半進行中'
                  : matchPhase === 'halftime'
                  ? '⏸️ ハーフタイム'
                  : matchPhase === '2nd_half'
                  ? '後半進行中'
                  : '🏁 試合終了'}
              </span>
            </div>

            <div className="text-xs font-mono font-bold text-amber-400">
              ⏱️ {matchTimerSeconds}s
            </div>
          </div>

          {/* Scoreboard */}
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 flex items-center justify-between gap-4 shadow-inner">
            <div className="text-left space-y-1 flex-1">
              <div className="text-[10px] font-mono text-indigo-400 font-bold uppercase">
                {currentPlayingSquad.name}
              </div>
              <div className="font-heading font-black text-lg sm:text-xl text-white truncate">
                @{userProfile.username || 'YOU'}
              </div>
              <div className="text-xs text-slate-400 font-mono">
                OVR {getTeamEffectiveOvr(currentPlayingSquad)}
              </div>
            </div>

            <div className="font-heading font-black text-4xl sm:text-6xl text-white font-mono tracking-widest px-4 py-2 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg">
              {currentScore[0]} - {currentScore[1]}
            </div>

            <div className="text-right space-y-1 flex-1">
              <div className="text-[10px] font-mono text-rose-400 font-bold uppercase">
                {activeOpponent.team?.name || 'Defense Squad'}
              </div>
              <div className="font-heading font-black text-lg sm:text-xl text-white truncate">
                @{activeOpponent.username}
              </div>
              <div className="text-xs text-slate-400 font-mono">
                OVR {getTeamEffectiveOvr(activeOpponent.team)}
              </div>
            </div>
          </div>

          {/* OVR Match Fast Skip Button */}
          {matchMode === 'OVR' && matchPhase !== 'finished' && (
            <div className="flex justify-center">
              <button
                onClick={() => {
                  soundManager.playButtonClick();
                  skipToOVRMatchResult();
                }}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-heading font-black text-xs tracking-wider shadow-lg flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
              >
                <FastForward className="w-4 h-4" />
                <span>⚡ 結果を今すぐ確認 (Skip to Full Time)</span>
              </button>
            </div>
          )}

          {/* Half-Time Tactics Adjustment Panel */}
          {matchPhase === 'halftime' && (
            <div className="bg-gradient-to-r from-indigo-950/80 to-blue-950/80 border-2 border-indigo-400 rounded-2xl p-5 space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⏸️</span>
                  <h4 className="font-heading font-black text-base text-white">
                    ハーフタイム戦術指示 (Half-Time Tactics)
                  </h4>
                </div>
                <span className="text-xs text-amber-300 font-bold">後半の展開に合わせて修正！</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1">
                    後半の攻撃戦術:
                  </label>
                  <select
                    value={halftimeTactics.attackTactic}
                    onChange={(e) =>
                      setHalftimeTactics({
                        ...halftimeTactics,
                        attackTactic: e.target.value as AttackTactics,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 text-xs text-white rounded-xl p-2.5 focus:outline-none focus:border-indigo-400 font-medium"
                  >
                    <option value="POSSESSION">⚽ ポゼッション (Possession)</option>
                    <option value="SHORT_PASS">🎯 ショートパス (Short Pass)</option>
                    <option value="DIRECT_PLAY">⚡ ダイレクトプレー (Direct Play)</option>
                    <option value="COUNTER">🚀 カウンター (Counter)</option>
                    <option value="LONG_BALL">🏹 ロングボール (Long Ball)</option>
                    <option value="WIDE_ATTACK">🌊 サイド攻撃 (Wide Attack)</option>
                    <option value="CROSS_GAME">👑 クロスゲーム (Cross Game)</option>
                    <option value="CENTRAL_ATTACK">🗡️ 中央突破 (Central Attack)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1">
                    後半の守備戦術:
                  </label>
                  <select
                    value={halftimeTactics.defenseTactic}
                    onChange={(e) =>
                      setHalftimeTactics({
                        ...halftimeTactics,
                        defenseTactic: e.target.value as DefenseTactics,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 text-xs text-white rounded-xl p-2.5 focus:outline-none focus:border-indigo-400 font-medium"
                  >
                    <option value="HIGH_PRESS">🔥 ハイプレス (High Press)</option>
                    <option value="MID_BLOCK">🛡️ ミドルブロック (Mid Block)</option>
                    <option value="LOW_BLOCK">🧱 ローブロック (Low Block)</option>
                    <option value="HIGH_LINE">⚡ ハイライン (High Line)</option>
                    <option value="DEFENSIVE_FOCUS">🔒 守備重視 (Defensive Focus)</option>
                  </select>
                </div>
              </div>

              <button
                onClick={resumeSecondHalf}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-heading font-black text-sm tracking-wider shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                <span>戦術を適用して後半開始 (Start 2nd Half)</span>
              </button>
            </div>
          )}

          {/* Live Event Feed */}
          <div className="space-y-2 max-h-56 overflow-y-auto p-2 bg-slate-950 rounded-2xl border border-slate-800">
            {liveEvents.map((evt, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded-xl text-xs flex items-center gap-2.5 animate-fadeIn ${
                  evt.type === 'goal'
                    ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40 font-bold'
                    : evt.type === 'tactic'
                    ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30'
                    : 'bg-slate-900 text-slate-300'
                }`}
              >
                <span className="font-mono font-bold text-slate-400 min-w-8">{evt.minute}'</span>
                <span className="flex-1">{language === 'ja' ? evt.textJa : evt.textEn}</span>
              </div>
            ))}
          </div>

          {/* Final Match Finished Action */}
          {matchPhase === 'finished' && finalMatchRecord && (
            <div className="p-5 rounded-3xl bg-gradient-to-b from-slate-900 to-slate-950 border-2 border-indigo-500/50 space-y-4 shadow-2xl animate-fadeIn">
              <div className="text-center space-y-1">
                <span
                  className={`inline-block px-4 py-1 rounded-full text-xs font-black tracking-wider uppercase border ${
                    finalMatchRecord.result === 'WIN'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-400/60 shadow-amber-500/20'
                      : finalMatchRecord.result === 'DRAW'
                      ? 'bg-slate-500/20 text-slate-300 border-slate-400/40'
                      : 'bg-rose-500/20 text-rose-300 border-rose-400/40'
                  }`}
                >
                  {finalMatchRecord.result === 'WIN'
                    ? '🏆 試合勝利 (VICTORY)'
                    : finalMatchRecord.result === 'DRAW'
                    ? '🤝 引き分け (DRAW)'
                    : '💔 試合敗北 (DEFEAT)'}
                </span>
                <h3 className="font-heading font-black text-2xl text-white">
                  {currentScore[0]} - {currentScore[1]}
                </h3>
                <p className="text-xs text-slate-400">
                  {finalMatchRecord.result === 'WIN'
                    ? '素晴らしい采配でした！リーグポイント +3 を獲得しました！'
                    : finalMatchRecord.result === 'DRAW'
                    ? '互角の白熱戦でした！リーグポイント +1 を獲得しました。'
                    : '惜しい結果となりました。フォーメーションや選手配置を調整してリベンジしましょう！'}
                </p>
              </div>

              <div className="flex justify-center gap-3 pt-2">
                <button
                  onClick={() => {
                    soundManager.playButtonClick();
                    setMatchMode(null);
                    setActiveOpponent(null);
                    refreshCommunityData(selectedSeason);
                  }}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-heading font-black text-xs tracking-wider shadow-lg cursor-pointer"
                >
                  対戦ロビーに戻る
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 1: MATCH LOBBY */}
      {activeTab === 'lobby' && !matchMode && (
        <div className="space-y-6">
          {/* Quick OVR Match Hero Banner */}
          <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-indigo-950/80 border-2 border-amber-500/50 rounded-3xl p-5 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-left">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-400/40 flex items-center justify-center text-2xl shrink-0 shadow-md">
                ⚡
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-widest">
                    Quick Match
                  </span>
                  <span className="px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/40">
                    即時対戦可能
                  </span>
                </div>
                <h3 className="font-heading font-black text-lg text-white">
                  ⚡ クイックOVR対戦 (Quick OVR Challenge)
                </h3>
                <p className="text-xs text-slate-300">
                  現在編成中のMy Team（OVR {getTeamEffectiveOvr(activePlayingSquad)}）で、おすすめのライバルチームと即座にOVR対戦を開始します。
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                soundManager.playButtonClick();
                const candidate = onlineUsers[0] || allRegisteredUsers[0];
                if (candidate) {
                  handleOpenPreMatch(candidate, 'OVR', onlineUsers[0] ? 'REALTIME' : 'ASYNC');
                }
              }}
              className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-heading font-black text-xs tracking-wider shadow-xl flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all shrink-0"
            >
              <Zap className="w-4 h-4 fill-slate-950" />
              <span>今すぐOVR対戦を開始</span>
            </button>
          </div>

          {/* Mode Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-slate-900 to-indigo-950/60 border border-indigo-500/30 rounded-3xl p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 font-black text-xs border border-indigo-500/40 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" />
                  <span>30秒ダイジェスト</span>
                </span>
                <span className="text-xs font-mono text-slate-400">FAST SIMULATION</span>
              </div>
              <h3 className="font-heading font-black text-xl text-white">
                ① 総合値マッチ (OVR Match)
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                作成したBest XIチームの総合値・選手能力を軸にした高速対戦モード。
                OVRが高いチームが有利となる厳格な勝率シミュレーションで30秒間の試合が展開されます。
              </p>
            </div>

            <div className="bg-gradient-to-br from-slate-900 to-blue-950/60 border border-blue-500/30 rounded-3xl p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300 font-black text-xs border border-blue-500/40 flex items-center gap-1">
                  <Sliders className="w-3.5 h-3.5" />
                  <span>前後半40秒 + ハーフタイム</span>
                </span>
                <span className="text-xs font-mono text-slate-400">TACTICAL ENGINE</span>
              </div>
              <h3 className="font-heading font-black text-xl text-white">
                ② 戦術マッチ (Tactical Match)
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                戦術相性・身長・選手個性が勝敗を左右する本格モード。
                OVRが低いチームでも、相性やハーフタイムの戦術変更次第で高OVRチームに大逆転勝利が可能です。
              </p>
            </div>
          </div>

          {/* ONLINE PLAYERS SECTION */}
          <div className="bg-gradient-to-b from-slate-900/95 to-slate-950 border-2 border-emerald-500/40 rounded-3xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400" />
                <h4 className="font-heading font-black text-base text-white">
                  ONLINE PLAYERS (現在オンライン中のプレイヤー)
                </h4>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-500/30">
                {onlineUsers.length} ONLINE
              </span>
            </div>

            {onlineUsers.length === 0 ? (
              <div className="text-center py-8 px-4 space-y-2 bg-slate-950/70 rounded-2xl border border-dashed border-slate-800">
                <div className="text-2xl">🟢</div>
                <div className="font-heading font-bold text-sm text-slate-200">
                  現在、他のオンラインプレイヤーは待機中またはオフラインです
                </div>
                <p className="text-xs text-slate-400 max-w-lg mx-auto">
                  {userProfile.username ? (
                    <>
                      あなた（<span className="text-emerald-300 font-bold">@{userProfile.username}</span>）はオンライン状態です。<br />
                      下記の一覧または検索タブから、登録済みユーザーのBest XIと<span className="text-amber-300 font-bold">非同期対戦（ASYNC MATCH）</span>が可能です！
                    </>
                  ) : (
                    <>
                      上のフォームでユーザーネームを登録すると、オンライン一覧に表示され対戦を受け付けられます！
                    </>
                  )}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {onlineUsers.map((opp) => {
                  const oppOvr = opp.team?.players?.length
                    ? Math.round(
                        opp.team.players.reduce((s, p) => s + p.rating, 0) / opp.team.players.length
                      )
                    : 85;

                  return (
                    <div
                      key={opp.userId}
                      className="p-4 rounded-2xl bg-slate-950 border-2 border-emerald-500/40 hover:border-emerald-400 transition-all flex flex-col justify-between gap-3 shadow-lg group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-10 h-10 rounded-xl bg-emerald-900/50 border border-emerald-400/40 flex items-center justify-center font-heading font-black text-base text-emerald-300">
                              {opp.username.substring(0, 2).toUpperCase()}
                            </div>
                            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-slate-950" />
                          </div>
                          <div>
                            <div className="font-heading font-black text-sm text-white flex items-center gap-1.5">
                              <span>@{opp.username}</span>
                              <span className="text-[10px] font-mono text-emerald-400 font-bold">ONLINE</span>
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {opp.team?.name || 'Best XI'} · {opp.team?.players?.length || 11} Players
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[10px] font-mono text-slate-400">OVR</div>
                          <div className="font-mono font-black text-base text-amber-400">{oppOvr}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                        {(() => {
                          const isOvrMatched = isOpponentMatchedInPhase(opp.userId, 'OVR');
                          const isTacMatched = isOpponentMatchedInPhase(opp.userId, 'TACTICAL');

                          if (isOvrMatched && isTacMatched) {
                            return (
                              <div className="flex-1 py-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center gap-1.5 shadow-inner">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span>今週対戦完了 (OVR・戦術済)</span>
                              </div>
                            );
                          }

                          return (
                            <>
                              {isOvrMatched ? (
                                <div className="flex-1 py-2 px-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                  <span>OVR済</span>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleOpenPreMatch(opp, 'OVR', 'REALTIME')}
                                  className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-heading font-black text-xs tracking-wider shadow-md transition-all flex items-center justify-center gap-1 cursor-pointer"
                                  title="OVR対戦を開始 (週1回制限)"
                                >
                                  <Zap className="w-3.5 h-3.5 fill-white" />
                                  <span>CHALLENGE</span>
                                </button>
                              )}

                              {isTacMatched ? (
                                <div className="py-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                                  <span>戦術済</span>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleOpenPreMatch(opp, 'TACTICAL', 'REALTIME')}
                                  className="py-2 px-3 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 border border-blue-500/40 text-xs font-bold transition-colors flex items-center justify-center gap-1 cursor-pointer"
                                  title="戦術対戦を開始 (週1回制限)"
                                >
                                  <Sliders className="w-3.5 h-3.5" />
                                  <span>戦術</span>
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ALL REGISTERED OPPONENTS */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                <h4 className="font-heading font-black text-base text-white">
                  ALL REGISTERED MANAGERS (登録ユーザー一覧 · 非同期対戦対応)
                </h4>
              </div>
              <span className="text-xs text-slate-400">
                {allRegisteredUsers.length} Registered
              </span>
            </div>

            {allRegisteredUsers.length === 0 ? (
              <div className="text-center py-10 px-4 space-y-3 bg-slate-950/60 rounded-2xl border border-dashed border-slate-800">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto text-xl">
                  👥
                </div>
                <div className="font-heading font-bold text-sm text-white">
                  まだ他のマネージャーが登録されていません
                </div>
                <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                  上のフォームからご自身のユーザーネームとBest XIチームを登録してください。<br />
                  検索バーにお友達のハンドルを入力して検索・対戦も可能です！
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {allRegisteredUsers.map((opp) => {
                  const oppOvr = opp.team?.players?.length
                    ? Math.round(
                        opp.team.players.reduce((s, p) => s + p.rating, 0) / opp.team.players.length
                      )
                    : 85;

                  const isOnline = onlineUsers.some((u) => u.userId === opp.userId);

                  return (
                    <div
                      key={opp.userId}
                      className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-indigo-500/40 transition-all flex flex-col justify-between gap-3 shadow-md"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-slate-800 to-indigo-900 flex items-center justify-center font-heading font-black text-base text-indigo-300 border border-indigo-500/30">
                            {opp.username.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-heading font-black text-sm text-white flex items-center gap-1.5">
                              <span>@{opp.username}</span>
                              <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                                isOnline
                                  ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-500/30'
                                  : 'text-slate-400 bg-slate-800'
                              }`}>
                                {isOnline ? '🟢 ONLINE' : '⚫ OFFLINE'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {opp.team?.name || 'Best XI'} · {getTeamFormationDisplayName(opp.team)}
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[10px] font-mono text-slate-400">TEAM OVR</div>
                          <div className="font-mono font-black text-base text-amber-400">{oppOvr}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                        {(() => {
                          const isOvrMatched = isOpponentMatchedInPhase(opp.userId, 'OVR');
                          const isTacMatched = isOpponentMatchedInPhase(opp.userId, 'TACTICAL');

                          if (isOvrMatched && isTacMatched) {
                            return (
                              <div className="flex-1 py-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center gap-1.5 shadow-inner">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span>今週対戦完了 (OVR・戦術済)</span>
                              </div>
                            );
                          }

                          return (
                            <>
                              {isOvrMatched ? (
                                <div className="flex-1 py-2 px-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                  <span>OVR対戦済</span>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleOpenPreMatch(opp, 'OVR', isOnline ? 'REALTIME' : 'ASYNC')}
                                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                    isOnline
                                      ? 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40'
                                      : 'bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40'
                                  }`}
                                  title="OVR対戦を開始 (週1回制限)"
                                >
                                  <Zap className="w-3.5 h-3.5" />
                                  <span>{isOnline ? 'CHALLENGE (OVR)' : 'ASYNC (OVR)'}</span>
                                </button>
                              )}

                              {isTacMatched ? (
                                <div className="py-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                                  <span>戦術済</span>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleOpenPreMatch(opp, 'TACTICAL', isOnline ? 'REALTIME' : 'ASYNC')}
                                  className="py-2 px-3 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 border border-blue-500/40 text-xs font-bold transition-colors flex items-center justify-center gap-1 cursor-pointer"
                                  title="戦術対戦を開始 (週1回制限)"
                                >
                                  <Sliders className="w-3.5 h-3.5" />
                                  <span>戦術対戦</span>
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: TACTICAL BOARD */}
      {activeTab === 'tactics' && !matchMode && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-xl">
          <div className="space-y-1">
            <h3 className="font-heading font-black text-xl text-white flex items-center gap-2">
              <Sliders className="w-5 h-5 text-indigo-400" />
              <span>チーム戦術ボード (Tactical Settings)</span>
            </h3>
            <p className="text-xs text-slate-400">
              多彩な攻撃・守備スタイルを設定して試合を有利に進めましょう。設定した戦術はSupabaseに保存されます。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Attack Tactics */}
            <div className="space-y-3 bg-slate-950/80 p-4 rounded-2xl border border-slate-800">
              <h4 className="font-heading font-bold text-sm text-emerald-400">
                ⚽ 攻撃戦術 (Attack Tactic)
              </h4>
              <div className="space-y-2">
                {[
                  { id: 'TIKI_TAKA', name: 'ティキ・タカ', desc: '超高密度なワンタッチパス連携で相手を翻弄' },
                  { id: 'FALSE_NINE', name: '偽9番 (ゼロトップ)', desc: 'CFが中盤に下りて数的優位と隙間を創出' },
                  { id: 'CROSS_GAME', name: 'クロスゲーム', desc: '大型ターゲットの制空権とウイングのクロス精度' },
                  { id: 'DIRECT_PLAY', name: 'ダイレクトプレー', desc: '手数をかけず縦へ素早く直線的に運ぶ' },
                  { id: 'COUNTER', name: 'カウンター', desc: '相手の前がかりな背後スペースを電光石火で急襲' },
                  { id: 'LONG_COUNTER', name: 'ロングカウンター', desc: '自陣深くから一気呵成にゴール前へ直撃' },
                  { id: 'OVERLOAD', name: 'オーバーロード', desc: '片サイドへ人数を過密配備し局所数的優位を形成' },
                  { id: 'THROUGH_PASS', name: '裏への抜け出し', desc: '最終ラインの背後へ鋭いスルーパスを通す' },
                  { id: 'POSSESSION', name: 'ポゼッション', desc: 'パスをつなぎ主導権を握りゲームを支配' },
                  { id: 'SHORT_PASS', name: 'ショートパス', desc: '細かな連携とトライアングルで崩す' },
                  { id: 'WIDE_ATTACK', name: 'サイド攻撃', desc: 'ウイングをピッチ一杯に活用したサイドアタック' },
                  { id: 'CENTRAL_ATTACK', name: '中央突破', desc: '中央密集地帯をコンビネーションで攻略' },
                  { id: 'LONG_BALL', name: 'ロングボール', desc: '前線ターゲットへ一気に供給し競り勝つ' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() =>
                      handleSaveTactics({ ...tactics, attackTactic: item.id as AttackTactics })
                    }
                    className={`w-full p-2.5 rounded-xl text-left text-xs transition-all flex items-center justify-between border ${
                      tactics.attackTactic === item.id
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 font-black shadow-md'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div>
                      <div className="font-bold">{item.name}</div>
                      <div className="text-[10px] opacity-70">{item.desc}</div>
                    </div>
                    {tactics.attackTactic === item.id && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Defense Tactics */}
            <div className="space-y-3 bg-slate-950/80 p-4 rounded-2xl border border-slate-800">
              <h4 className="font-heading font-bold text-sm text-indigo-400">
                🛡️ 守備戦術 (Defense Tactic)
              </h4>
              <div className="space-y-2">
                {[
                  { id: 'OFFSIDE_TRAP', name: 'オフサイドトラップ', desc: '統率された最終ラインで相手の裏抜けを一網打尽' },
                  { id: 'SWARM_DEFENSE', name: 'スウォーム守備', desc: 'ボールホルダーを群れで包囲しパスコースを完全遮断' },
                  { id: 'CATENACCIO', name: 'カテナチオ', desc: '伝統の鍵をかける堅牢無比な中央施錠ブロック' },
                  { id: 'BOX_CONTAIN', name: 'PA封鎖', desc: 'ペナルティエリア内に分厚い壁を築き侵入を拒絶' },
                  { id: 'GEGENPRESSING', name: 'ゲーゲンプレス', desc: 'ボール奪われた瞬間から全員で即時猛烈プレス' },
                  { id: 'HIGH_PRESS', name: 'ハイプレス', desc: '相手陣内深くから激しくボールを奪取' },
                  { id: 'MID_BLOCK', name: 'ミドルブロック', desc: '中盤で安定した陣形を敷きスペースを管理' },
                  { id: 'LOW_BLOCK', name: 'ローブロック', desc: '自陣ゴール前を固めて相手の決定機を排除' },
                  { id: 'MAN_MARK', name: 'マンマーク', desc: '相手キーマンに密着し仕事を一切させない' },
                  { id: 'ZONE_DEFENSE', name: 'ゾーンディフェンス', desc: '自陣のエリアを均等に守り破綻を防ぐ' },
                  { id: 'COUNTER_PREVENT', name: 'カウンター対策', desc: '常に相手の速攻に備えて背後をカバー' },
                  { id: 'DEFENSIVE_FOCUS', name: '守備重視', desc: 'リスクを徹底的に排除した安全第一の守備' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() =>
                      handleSaveTactics({ ...tactics, defenseTactic: item.id as DefenseTactics })
                    }
                    className={`w-full p-2.5 rounded-xl text-left text-xs transition-all flex items-center justify-between border ${
                      tactics.defenseTactic === item.id
                        ? 'bg-indigo-500/20 border-indigo-400 text-indigo-200 font-black shadow-md'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div>
                      <div className="font-bold">{item.name}</div>
                      <div className="text-[10px] opacity-70">{item.desc}</div>
                    </div>
                    {tactics.defenseTactic === item.id && (
                      <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: USER SEARCH */}
      {activeTab === 'friends' && !matchMode && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-xl">
          <div className="space-y-1">
            <h3 className="font-heading font-black text-xl text-white flex items-center gap-2">
              <Search className="w-5 h-5 text-indigo-400" />
              <span>🔍 ユーザー検索 (Search Players)</span>
            </h3>
            <p className="text-xs text-slate-400">
              Supabaseに登録されているプレイヤーを検索し、オンライン対戦または非同期対戦（ASYNC MATCH）を開始できます。
            </p>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="🔍 Search players... (例: Leo, Champion, King)"
              className="w-full bg-slate-950 border border-slate-700 pl-10 pr-4 py-3 rounded-2xl text-xs text-white placeholder-slate-500 focus:border-indigo-400 focus:outline-none font-medium"
            />
          </div>

          <div className="space-y-3">
            {isSearching ? (
              <div className="text-center py-8 text-slate-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Supabaseを検索中...</span>
              </div>
            ) : searchQuery && searchResults.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs bg-slate-950/40 rounded-2xl border border-slate-800 p-6">
                「{searchQuery}」に一致する登録ユーザーは見つかりませんでした。
              </div>
            ) : !searchQuery && allRegisteredUsers.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs bg-slate-950/40 rounded-2xl border border-dashed border-slate-800 p-6">
                登録ユーザーがまだいません。検索バーにユーザーネームを入力して検索してください。
              </div>
            ) : (
              (searchQuery ? searchResults : allRegisteredUsers).map((user) => {
                const isOnline = onlineUsers.some((u) => u.userId === user.userId) || user.isOnline;
                const userOvr = user.team?.players?.length
                  ? Math.round(
                      user.team.players.reduce((s, p) => s + p.rating, 0) / user.team.players.length
                    )
                  : 85;

                return (
                  <div
                    key={user.userId}
                    className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-4 hover:border-indigo-500/40 transition-all shadow-md"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-11 h-11 rounded-2xl bg-indigo-600/20 border border-indigo-400/40 flex items-center justify-center font-heading font-black text-indigo-300 text-sm">
                          {user.username.substring(0, 2).toUpperCase()}
                        </div>
                        <span className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-slate-950 ${
                          isOnline ? 'bg-emerald-500' : 'bg-slate-600'
                        }`} />
                      </div>
                      <div>
                        <div className="font-heading font-black text-sm text-white flex items-center gap-2">
                          <span>@{user.username}</span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${
                            isOnline
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {isOnline ? '🟢 ONLINE' : '⚫ OFFLINE'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                          <span>{user.team?.name || 'Best XI'}</span>
                          <span>•</span>
                          <span className="font-mono text-amber-400 font-bold">OVR {userOvr}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {(() => {
                        const isOvrMatched = isOpponentMatchedInPhase(user.userId, 'OVR');
                        const isTacMatched = isOpponentMatchedInPhase(user.userId, 'TACTICAL');

                        if (isOvrMatched && isTacMatched) {
                          return (
                            <div className="py-2 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-400 text-xs font-bold flex items-center gap-1.5 shadow-inner">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>今週対戦完了 (OVR・戦術済)</span>
                            </div>
                          );
                        }

                        return (
                          <>
                            {isOvrMatched ? (
                              <div className="py-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-400 text-xs font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                <span>OVR済</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleOpenPreMatch(user, 'OVR', isOnline ? 'REALTIME' : 'ASYNC')}
                                className={`py-2 px-3.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 shadow-md cursor-pointer ${
                                  isOnline
                                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white font-heading font-black'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white font-heading font-black'
                                }`}
                                title="OVR対戦を開始 (週1回制限)"
                              >
                                <Zap className="w-3.5 h-3.5 fill-white" />
                                <span>{isOnline ? 'CHALLENGE (OVR)' : 'ASYNC (OVR)'}</span>
                              </button>
                            )}

                            {isTacMatched ? (
                              <div className="py-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-400 text-xs font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                                <span>戦術済</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleOpenPreMatch(user, 'TACTICAL', isOnline ? 'REALTIME' : 'ASYNC')}
                                className="py-2 px-3 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 border border-blue-500/40 text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                                title="戦術対戦を開始 (週1回制限)"
                              >
                                <Sliders className="w-3.5 h-3.5" />
                                <span>戦術対戦</span>
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 4: WEEKLY STANDINGS (Requirement 2 & 3) */}
      {activeTab === 'standings' && !matchMode && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-xl">
          {/* Header & Season Selector */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono text-xs font-black border border-amber-500/40 flex items-center gap-1">
                  <Trophy className="w-3.5 h-3.5" />
                  <span>WEEKLY RANKINGS (JST)</span>
                </span>
                {selectedSeason === currentSeasonInfo.seasonNumber ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    <span>開催中 (ACTIVE)</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-mono font-bold">
                    過去シーズン (ARCHIVE)
                  </span>
                )}
              </div>
              <h3 className="font-heading font-black text-xl sm:text-2xl text-white">
                🏆 週間シーズンランキング
              </h3>
              <div className="text-xs text-slate-400 flex items-center gap-2 pt-0.5 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="font-mono text-indigo-200">
                    {formatSeasonPeriod(selectedSeason, language)}
                  </span>
                </span>
                {selectedSeason === currentSeasonInfo.seasonNumber && (
                  <span className="flex items-center gap-1 text-emerald-400 font-mono font-bold text-[11px] bg-emerald-950/60 px-2 py-0.5 rounded-lg border border-emerald-500/30">
                    <Clock className="w-3 h-3 text-emerald-400 animate-pulse" />
                    <span>{getSeasonInfo(selectedSeason).remainingTimeTextJa}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Season Selector & Refresh */}
            <div className="flex items-center gap-2 self-start lg:self-auto flex-wrap">
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-2xl border border-slate-800">
                <label className="text-[11px] font-bold text-slate-400 px-2 font-mono">SEASON:</label>
                <select
                  value={selectedSeason}
                  onChange={(e) => {
                    const sNum = Number(e.target.value);
                    setSelectedSeason(sNum);
                    loadStandingsData(sNum, standingsFilter);
                  }}
                  className="bg-slate-900 border border-slate-700 text-white text-xs font-bold font-mono py-1.5 px-3 rounded-xl focus:outline-none focus:border-amber-400"
                >
                  {historicalSeasons.map((s) => (
                    <option key={s.seasonNumber} value={s.seasonNumber}>
                      Season {s.seasonNumber} ({s.seasonNameJa})
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={async () => {
                  soundManager.playButtonClick();
                  await performFullOnlineSync(true);
                  await loadStandingsData(selectedSeason, standingsFilter);
                  setStandingsNotice('全端末の最新ランキングを即座に集計・同期完了しました！');
                  setTimeout(() => setStandingsNotice(null), 3000);
                }}
                disabled={isLoadingStandings || syncStatus.state === 'SYNCING'}
                className="p-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-1.5 text-xs font-bold"
                title="ランキングを再取得して同期"
              >
                <RefreshCw className={`w-4 h-4 ${(isLoadingStandings || syncStatus.state === 'SYNCING') ? 'animate-spin text-amber-400' : ''}`} />
                <span className="hidden sm:inline">再同期</span>
              </button>
            </div>
          </div>

          {/* 10-Minute Online Ranking Synchronization Status Bar */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950/70 via-slate-900 to-slate-950 border border-indigo-500/40 flex flex-wrap items-center justify-between gap-3 shadow-md">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex items-center gap-2 bg-indigo-900/60 px-2.5 py-1 rounded-xl border border-indigo-400/40 text-[11px] font-bold text-indigo-200">
                {syncStatus.state === 'SYNCING' ? (
                  <>
                    <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
                    <span className="text-amber-300">オンライン同期中...</span>
                  </>
                ) : syncStatus.state === 'ERROR' ? (
                  <>
                    <AlertCircle className="w-3 h-3 text-rose-400" />
                    <span className="text-rose-300">一時的通信待機</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>10分定時オンライン同期中</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-300 font-mono">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-slate-400">次回自動同期まで:</span>
                <span className="font-bold text-amber-300 bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-700">
                  {Math.floor(syncStatus.secondsRemaining / 60)}分{String(syncStatus.secondsRemaining % 60).padStart(2, '0')}秒
                </span>
              </div>
              {syncStatus.lastSyncTimeString && (
                <div className="text-[11px] text-slate-400 font-mono hidden sm:flex items-center gap-1.5">
                  <span>(最終同期: {syncStatus.lastSyncTimeString})</span>
                  {syncMetadata && (
                    <span className="text-emerald-400 font-semibold">
                      • 全{syncMetadata.totalMatches}試合集計済
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {onOpenSyncDebug && (
                <button
                  id="pvp-standings-sync-debug-btn"
                  onClick={onOpenSyncDebug}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 text-xs font-bold transition-all flex items-center gap-1.5 shadow"
                  title="オンラインDB接続状態・同期デバッグ情報を確認"
                >
                  <Database className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">同期デバッグ</span>
                </button>
              )}
              <button
                onClick={async () => {
                  soundManager.playButtonClick();
                  await performFullOnlineSync(true);
                  await loadStandingsData(selectedSeason, standingsFilter);
                  setStandingsNotice('全端末の最新ランキングを即座に集計・同期完了しました！');
                  setTimeout(() => setStandingsNotice(null), 3000);
                }}
                disabled={isLoadingStandings || syncStatus.state === 'SYNCING'}
                className="px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-400/40 text-indigo-200 hover:text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow"
                title="今すぐ最新データを取得して同期"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${(isLoadingStandings || syncStatus.state === 'SYNCING') ? 'animate-spin text-amber-400' : ''}`} />
                <span>今すぐ手動同期</span>
              </button>
            </div>
          </div>

          {/* Standings Feedback Notice */}
          {standingsNotice && (
            <div className="p-3 rounded-2xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-xs flex items-center justify-between animate-fadeIn">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{standingsNotice}</span>
              </div>
              <button
                onClick={() => setStandingsNotice(null)}
                className="text-emerald-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>
          )}

          {/* Aggregation Window Banner */}
          {isSeasonInAggregationPhase(selectedSeason) && (
            <div className="p-3.5 rounded-2xl bg-amber-950/60 border border-amber-500/60 text-amber-300 text-xs flex items-center gap-3 animate-pulse shadow-lg">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <strong className="text-white">【ランキング集計中】(月曜 00:00〜00:59 JST)</strong>:
                前週の対戦フェーズが終了し集計中です。月曜01:00に順位が確定し、上位3名へプレゼントBOXに確定報酬が自動配布されます。
              </div>
            </div>
          )}

          {/* Weekly Ranking Rewards Showcase */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-amber-500/20 via-yellow-600/10 to-slate-950 border border-amber-400/40 space-y-1 shadow-md">
              <div className="flex items-center justify-between">
                <span className="font-heading font-black text-xs text-yellow-300 flex items-center gap-1">
                  <span>🥇 1位 週間確定報酬</span>
                </span>
                <span className="text-[10px] font-mono text-amber-400 font-bold px-1.5 py-0.2 rounded bg-amber-400/10">1位限定</span>
              </div>
              <div className="text-xs font-bold text-white">
                レジェンド確定スカウト ×1
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                1位の1名のみに自動配布 (二重配布なし)
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-purple-800/25 via-fuchsia-950/15 to-slate-950 border border-purple-400/40 space-y-1 shadow-md">
              <div className="flex items-center justify-between">
                <span className="font-heading font-black text-xs text-purple-200 flex items-center gap-1">
                  <span>🥈 2位 週間確定報酬</span>
                </span>
                <span className="text-[10px] font-mono text-purple-300 font-bold px-1.5 py-0.2 rounded bg-purple-400/10">2位限定</span>
              </div>
              <div className="text-xs font-bold text-white">
                紫演出確定スカウト ×1
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                2位の1名のみに自動配布 (二重配布なし)
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-700/20 via-blue-900/10 to-slate-950 border border-indigo-500/40 space-y-1 shadow-md">
              <div className="flex items-center justify-between">
                <span className="font-heading font-black text-xs text-indigo-300 flex items-center gap-1">
                  <span>🥉 3位 週間確定報酬</span>
                </span>
                <span className="text-[10px] font-mono text-indigo-400 font-bold px-1.5 py-0.2 rounded bg-indigo-600/10">3位限定</span>
              </div>
              <div className="text-xs font-bold text-white">
                レジェンド・紫50%スカウト ×1
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                3位の1名のみに自動配布 (4位以下は配布対象外)
              </div>
            </div>
          </div>

          {/* Ranking Type Filter (OVR vs Tactical vs All) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 p-1 bg-slate-950/80 rounded-2xl border border-slate-800">
              <button
                onClick={() => {
                  soundManager.playButtonClick();
                  setStandingsFilter('ALL');
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  standingsFilter === 'ALL'
                    ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                総合 (ALL)
              </button>
              <button
                onClick={() => {
                  soundManager.playButtonClick();
                  setStandingsFilter('OVR');
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                  standingsFilter === 'OVR'
                    ? 'bg-gradient-to-r from-amber-500 to-yellow-600 text-slate-950 font-black shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>⚡ OVR対戦ランキング</span>
              </button>
              <button
                onClick={() => {
                  soundManager.playButtonClick();
                  setStandingsFilter('TACTICAL');
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                  standingsFilter === 'TACTICAL'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>🧠 戦術対戦ランキング</span>
              </button>
            </div>

            <div className="text-[11px] text-slate-400 font-mono">
              集計対象: {weeklyStandings.length} 名のマネージャー (勝利 3pt / 引分 1pt / 敗北 0pt)
            </div>
          </div>

          {/* Standings Table */}
          {isLoadingStandings ? (
            <div className="text-center py-16 text-slate-400 text-xs flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
              <span>Supabaseより実在ユーザーの週間ランキングを集計中...</span>
            </div>
          ) : weeklyStandings.length === 0 ? (
            <div className="text-center py-14 px-4 space-y-3 bg-slate-950/60 rounded-2xl border border-dashed border-slate-800">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-300 flex items-center justify-center mx-auto text-xl">
                🏆
              </div>
              <div className="font-heading font-bold text-sm text-white">
                Season {selectedSeason} の対戦記録はまだありません
              </div>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                対戦ロビーから試合を行うと、週間ランキングに自動登録・反映されます！
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 font-mono uppercase border-b border-slate-800">
                  <tr>
                    <th className="p-3 w-16 text-center">Rank</th>
                    <th className="p-3">Manager / Best XI</th>
                    <th className="p-3 text-center">Matches</th>
                    <th className="p-3 text-center">W - D - L</th>
                    <th className="p-3 text-center">GD</th>
                    <th className="p-3 text-right">Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {weeklyStandings.map((st) => {
                    const isMe = st.userId === userProfile.userId;

                    const getMedalBadge = (rank: number) => {
                      if (rank === 1) return '🥇 #1';
                      if (rank === 2) return '🥈 #2';
                      if (rank === 3) return '🥉 #3';
                      return `#${rank}`;
                    };

                    return (
                      <tr
                        key={st.userId}
                        className={
                          isMe
                            ? 'bg-indigo-950/50 text-indigo-100 font-bold border-l-4 border-indigo-400'
                            : st.rank <= 3
                            ? 'bg-slate-950/60 hover:bg-slate-900/60 text-slate-200'
                            : 'hover:bg-slate-950/40 text-slate-300'
                        }
                      >
                        <td className="p-3 text-center font-mono font-black">
                          <span className={
                            st.rank === 1
                              ? 'text-yellow-400 text-sm font-black'
                              : st.rank === 2
                              ? 'text-slate-300 text-sm font-black'
                              : st.rank === 3
                              ? 'text-amber-600 text-sm font-black'
                              : 'text-slate-400'
                          }>
                            {getMedalBadge(st.rank)}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-heading font-black text-white">@{st.username}</span>
                            {isMe && (
                              <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[9px] font-bold border border-indigo-400/30">
                                YOU
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {st.teamName} · <span className="font-mono text-amber-400 font-bold">OVR {st.teamOvr}</span>
                          </div>
                        </td>
                        <td className="p-3 text-center font-mono text-slate-300">
                          {st.matchesCount}
                        </td>
                        <td className="p-3 text-center font-mono">
                          <span className="text-emerald-400 font-bold">{st.wins}</span>
                          <span className="text-slate-500 mx-1">-</span>
                          <span className="text-amber-400">{st.draws}</span>
                          <span className="text-slate-500 mx-1">-</span>
                          <span className="text-rose-400">{st.losses}</span>
                        </td>
                        <td className="p-3 text-center font-mono font-bold">
                          <span className={st.goalDifference > 0 ? 'text-emerald-400' : st.goalDifference < 0 ? 'text-rose-400' : 'text-slate-400'}>
                            {st.goalDifference > 0 ? `+${st.goalDifference}` : st.goalDifference}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono font-black text-sm text-amber-300">
                          {st.points} pts
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: MATCH HISTORY */}
      {activeTab === 'history' && !matchMode && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h3 className="font-heading font-black text-xl text-white flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-400" />
                <span>MATCH HISTORY (対戦履歴)</span>
              </h3>
              <p className="text-xs text-slate-400">
                Supabaseクラウドに保存されたあなたの対戦履歴です（v1.1.3以降の週間シーズン対応）。
              </p>
            </div>
            <button
              onClick={() => refreshCommunityData(selectedSeason)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingUsers ? 'animate-spin' : ''}`} />
              <span>再読み込み</span>
            </button>
          </div>

          {matchHistory.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs bg-slate-950/40 rounded-2xl border border-dashed border-slate-800 p-6">
              対戦履歴はまだありません。対戦ロビーから試合を行ってください。
            </div>
          ) : (
            <div className="space-y-3">
              {matchHistory.map((rec) => {
                const isWin = rec.result === 'WIN';
                const isDraw = rec.result === 'DRAW';

                return (
                  <div
                    key={rec.id}
                    className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-4 hover:border-slate-700 transition-all shadow-md"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-lg text-xs font-black uppercase font-mono tracking-wider flex items-center gap-1 ${
                            isWin
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                              : isDraw
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                              : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                          }`}
                        >
                          {isWin ? '🏆 WIN' : isDraw ? '🤝 DRAW' : '❌ LOSS'}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                          {rec.matchCategory || 'ASYNC'}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          {rec.matchType === 'OVR' ? '⚡ 総合値マッチ' : '🧠 戦術マッチ'}
                        </span>
                        {rec.season && (
                          <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950 px-2 py-0.5 rounded border border-indigo-500/30">
                            Season {rec.season}
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-bold text-white">
                        vs @{rec.opponentUsername}
                        <span className="text-xs font-normal text-slate-400 ml-1.5">
                          ({rec.opponentTeamName || 'Opponent Squad'})
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {formatRelativeTime(rec.timestamp, language)} · {new Date(rec.timestamp).toLocaleTimeString()}
                      </div>
                    </div>

                    <div className="text-right flex flex-col items-end">
                      <div className={`font-heading font-black text-2xl sm:text-3xl font-mono tracking-wider ${
                        isWin ? 'text-emerald-400' : isDraw ? 'text-amber-400' : 'text-rose-400'
                      }`}>
                        {rec.challengerScore} - {rec.opponentScore}
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        {rec.points > 0 ? `+${rec.points} pt` : '0 pt'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
