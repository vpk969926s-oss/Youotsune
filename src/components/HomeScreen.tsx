import React from 'react';
import { GameMode, Language, Player, UserTeam } from '../types';
import { TRANSLATIONS } from '../utils/translations';
import { soundManager } from '../utils/audio';
import { CURRENT_VERSION } from '../data/versionConfig';
import {
  Play,
  HelpCircle,
  History,
  Users,
  Settings,
  Sparkles,
  ChevronRight,
  ArrowRight,
  Plus,
  FileText,
  Swords,
  Gift,
  Ticket,
  Trophy,
} from 'lucide-react';

interface HomeScreenProps {
  mode: GameMode;
  onOpenModeSelect: () => void;
  onNavigate: (tab: 'home' | 'draft' | 'team' | 'history' | 'pvp') => void;
  onOpenHowToPlay: () => void;
  onOpenSettings: () => void;
  onOpenUpdateNotes?: () => void;
  onOpenGiftBox?: () => void;
  onOpenScoutModal?: () => void;
  unclaimedGiftsCount?: number;
  totalTicketsCount?: number;
  teams?: UserTeam[];
  activeTeam?: UserTeam;
  myTeam: Player[];
  historyCount: number;
  language: Language;
  onCreateNewTeam?: () => void;
  hasActiveSpin?: boolean;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  mode,
  onOpenModeSelect,
  onNavigate,
  onOpenHowToPlay,
  onOpenSettings,
  onOpenUpdateNotes,
  teams,
  activeTeam,
  myTeam,
  historyCount,
  language,
  onCreateNewTeam,
  hasActiveSpin,
  onOpenGiftBox,
  onOpenScoutModal,
  unclaimedGiftsCount = 0,
  totalTicketsCount = 0,
}) => {
  const t = TRANSLATIONS[language];
  const isInProgress = myTeam.length < 11 || hasActiveSpin;

  const handlePlayClick = () => {
    soundManager.playButtonClick();
    // Seamless background state management:
    // If user has an in-progress squad or active spin, directly continue draft
    // If a squad was completed and user hits PLAY, take them to draft or mode select
    if (isInProgress) {
      onNavigate('draft');
    } else {
      onOpenModeSelect();
    }
  };

  return (
    <div
      id="home-screen-container"
      className="max-w-xl w-full mx-auto flex flex-col items-center justify-center space-y-6 sm:space-y-8 py-4 sm:py-8 px-3 select-none"
    >
      {/* Hero Header Banner */}
      <div className="text-center space-y-3 relative w-full">
        {/* Glow backdrop */}
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-64 h-32 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Brand Icon */}
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-gradient-to-tr from-emerald-500 via-teal-400 to-amber-300 p-0.5 mx-auto shadow-2xl shadow-emerald-500/30 flex items-center justify-center transform hover:scale-105 transition-transform">
          <div className="w-full h-full bg-slate-950 rounded-[22px] flex items-center justify-center">
            <span className="text-3xl sm:text-4xl">⚽</span>
          </div>
        </div>

        {/* Main Title */}
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-bold uppercase tracking-widest">
            <Sparkles className="w-3.5 h-3.5" />
            <span>YEAR × CLUB ROULETTE DRAFT</span>
          </div>

          <h1 className="font-heading font-black text-3xl sm:text-5xl text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-200 to-amber-300 tracking-wider">
            {t.appTitle}
          </h1>

          <p className="font-heading font-extrabold text-base sm:text-xl text-slate-300 tracking-wide">
            {t.appSubtitle}
          </p>
        </div>

        {/* Version & Update Notes Badge */}
        {onOpenUpdateNotes && (
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              id="home-version-badge-btn"
              onClick={() => {
                soundManager.playButtonClick();
                onOpenUpdateNotes();
              }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/90 border border-emerald-500/30 hover:border-emerald-400 text-xs text-slate-300 hover:text-white transition-all shadow-md group cursor-pointer"
            >
              <span className="font-mono font-black text-[11px] text-emerald-400">
                {CURRENT_VERSION}
              </span>
              <span className="w-1 h-1 rounded-full bg-emerald-400" />
              <span className="text-[11px] font-bold text-slate-300 group-hover:text-emerald-300 flex items-center gap-1">
                <FileText className="w-3 h-3 text-emerald-400" />
                <span>UPDATE NOTES</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        )}

        {/* Active Universe Pill */}
        <div className="flex items-center justify-center gap-2 pt-0.5">
          <span className="text-xs text-slate-400 font-medium">Selected Universe:</span>
          <button
            onClick={() => {
              soundManager.playButtonClick();
              onOpenModeSelect();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-900 border border-slate-700 hover:border-emerald-400 text-xs font-bold text-emerald-300 transition-all shadow-sm"
          >
            <span>
              {mode === 'europe'
                ? '🇪🇺 EUROPEAN CLUBS'
                : '🇯🇵 J1 LEAGUE'}
            </span>
            <span className="text-[10px] text-slate-400 font-mono underline">Change</span>
          </button>
        </div>
      </div>

      {/* Main Big Navigation Actions */}
      <div className="w-full space-y-3 max-w-lg">
        {/* 1. PRIMARY CTA: ALWAYS 'PLAY' (Never 'CONTINUE TEAM' or 'CONTINUE DRAFT') */}
        <button
          id="btn-home-play"
          onClick={handlePlayClick}
          className="w-full p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-heading font-black text-xl sm:text-2xl tracking-wider shadow-2xl shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-0.5 active:scale-[0.98] transition-all flex items-center justify-between group"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-slate-950/20 flex items-center justify-center text-2xl group-hover:rotate-12 transition-transform">
              ⚽
            </div>
            <div className="text-left">
              <div className="leading-tight font-black">
                PLAY
              </div>
              <div className="text-xs text-slate-950/80 font-bold font-sans">
                {mode === 'europe' ? 'European Clubs Draft' : 'J1 League Draft'}
              </div>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-950/20 flex items-center justify-center group-hover:translate-x-1 transition-transform">
            <ArrowRight className="w-5 h-5 text-slate-950 stroke-[3]" />
          </div>
        </button>

        {/* 2. HOW TO PLAY */}
        <button
          id="btn-home-how-to-play"
          onClick={() => {
            soundManager.playButtonClick();
            onOpenHowToPlay();
          }}
          className="w-full p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-amber-500/40 text-white font-heading font-bold text-base tracking-wide transition-all flex items-center justify-between group shadow-lg"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center border border-amber-500/30">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div>{t.howToPlay}</div>
              <div className="text-xs text-slate-400 font-normal font-sans">
                Rules, Spin Locks & Skip Guidelines
              </div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-amber-300 group-hover:translate-x-1 transition-all" />
        </button>

        {/* 3. HISTORY */}
        <button
          id="btn-home-history"
          onClick={() => {
            soundManager.playButtonClick();
            onNavigate('history');
          }}
          className="w-full p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/40 text-white font-heading font-bold text-base tracking-wide transition-all flex items-center justify-between group shadow-lg"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center border border-emerald-500/30">
              <History className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div>{t.history}</div>
              <div className="text-xs text-slate-400 font-normal font-sans">
                Search in JA / EN / ES & Review Records
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              {historyCount}
            </span>
            <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
          </div>
        </button>

        {/* 4. MY TEAM */}
        <button
          id="btn-home-my-team"
          onClick={() => {
            soundManager.playButtonClick();
            onNavigate('team');
          }}
          className="w-full p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-teal-500/40 text-white font-heading font-bold text-base tracking-wide transition-all flex items-center justify-between group shadow-lg"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-300 flex items-center justify-center border border-teal-500/30">
              <Users className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div>{t.myTeam}</div>
              <div className="text-xs text-slate-400 font-normal font-sans">
                Tactical Pitch, Share Team & Formations
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-mono font-black px-2.5 py-0.5 rounded-full ${
                myTeam.length === 11
                  ? 'bg-amber-400 text-slate-950 animate-pulse'
                  : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
              }`}
            >
              {myTeam.length}/11
            </span>
            <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-teal-400 group-hover:translate-x-1 transition-all" />
          </div>
        </button>

        {/* 5. PvP MATCH MODE (BETA) */}
        <button
          id="btn-home-pvp"
          onClick={() => {
            soundManager.playButtonClick();
            onNavigate('pvp');
          }}
          className="w-full p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-indigo-950/80 via-slate-900 to-slate-900 hover:from-indigo-900/90 hover:to-slate-850 border border-indigo-500/40 hover:border-indigo-400 text-white font-heading font-bold text-base tracking-wide transition-all flex items-center justify-between group shadow-lg shadow-indigo-950/50"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center border border-indigo-500/40 shadow-inner">
              <Swords className="w-5 h-5 text-indigo-400 group-hover:rotate-12 transition-transform" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span>ONLINE PvP BATTLE</span>
                <span className="text-[9px] font-mono font-black px-2 py-0.2 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 text-white animate-pulse shadow-sm">
                  BETA
                </span>
              </div>
              <div className="text-xs text-slate-400 font-normal font-sans">
                Real User Async Matchmaking & Standings
              </div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
        </button>

        {/* 5.5 REWARD SCOUT & PRESENT BOX ROW */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* REWARD SCOUT */}
          <button
            id="btn-home-scout"
            onClick={() => {
              soundManager.playButtonClick();
              if (onOpenScoutModal) onOpenScoutModal();
            }}
            className="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-950/90 to-slate-900 border border-indigo-500/40 hover:border-indigo-400 text-white font-heading font-bold text-sm tracking-wide transition-all flex items-center justify-between group shadow-lg shadow-indigo-950/30"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center border border-indigo-500/30 shrink-0">
                <Ticket className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-left">
                <div className="text-xs font-black leading-tight flex items-center gap-1.5">
                  <span>スカウト</span>
                  {totalTicketsCount > 0 && (
                    <span className="text-[10px] font-mono font-black px-1.5 py-0.2 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 shadow-sm animate-pulse">
                      {totalTicketsCount}枚
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 font-normal">
                  報酬スカウト
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-300 group-hover:translate-x-0.5 transition-transform" />
          </button>

          {/* PRESENT BOX */}
          <button
            id="btn-home-gift-box"
            onClick={() => {
              soundManager.playButtonClick();
              if (onOpenGiftBox) onOpenGiftBox();
            }}
            className="p-3.5 rounded-2xl bg-gradient-to-br from-amber-950/70 to-slate-900 border border-amber-500/40 hover:border-amber-400 text-white font-heading font-bold text-sm tracking-wide transition-all flex items-center justify-between group shadow-lg shadow-amber-950/30"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center border border-amber-500/30 shrink-0">
                <Gift className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-left">
                <div className="text-xs font-black leading-tight flex items-center gap-1.5">
                  <span>BOX</span>
                  {unclaimedGiftsCount > 0 && (
                    <span className="text-[10px] font-mono font-black px-1.5 py-0.2 rounded-full bg-rose-500 text-white shadow-sm animate-bounce">
                      {unclaimedGiftsCount}件
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 font-normal">
                  プレゼント
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-amber-300 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>

        {/* 6. SETTINGS */}
        <button
          id="btn-home-settings"
          onClick={() => {
            soundManager.playButtonClick();
            onOpenSettings();
          }}
          className="w-full p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-slate-600 text-white font-heading font-bold text-base tracking-wide transition-all flex items-center justify-between group shadow-lg"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-slate-800 text-slate-300 flex items-center justify-center border border-slate-700">
              <Settings className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div>{t.settings}</div>
              <div className="text-xs text-slate-400 font-normal font-sans">
                Language, Audio & Reset Game
              </div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-slate-200 group-hover:translate-x-1 transition-all" />
        </button>
      </div>

      {/* Internal In-Progress Squad Status Snippet */}
      {myTeam.length > 0 && (
        <div className="w-full max-w-lg p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800/90 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3">
            <div className="text-xl">🛡️</div>
            <div>
              <div className="text-xs font-bold text-slate-300">
                {activeTeam?.name || 'Active Squad'}: <span className="text-emerald-400 font-black">{myTeam.length}/11 Players</span>
              </div>
              <div className="text-[11px] text-slate-400 truncate max-w-[200px] sm:max-w-xs">
                Last: {myTeam[myTeam.length - 1].playerName} ({myTeam[myTeam.length - 1].clubName})
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              soundManager.playButtonClick();
              onNavigate('team');
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-bold transition-colors"
          >
            {t.viewTeam}
          </button>
        </div>
      )}
    </div>
  );
};
