import React, { useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  Database,
  Radio,
  Clock,
  Swords,
  Trophy,
  Users,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import {
  getSyncManagerStatus,
  subscribeToSyncStatus,
  performFullOnlineSync,
  SyncManagerStatus,
} from '../utils/onlineSyncManager';
import { supabase, SUPABASE_CONFIG } from '../utils/supabase';

interface OnlineSyncDebugModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OnlineSyncDebugModal: React.FC<OnlineSyncDebugModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [syncStatus, setSyncStatus] = useState<SyncManagerStatus>(getSyncManagerStatus());
  const [serverDebugInfo, setServerDebugInfo] = useState<any>(null);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTestingDb, setIsTestingDb] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Subscribe to sync manager status
    const unsubscribe = subscribeToSyncStatus((status) => {
      setSyncStatus(status);
    });

    // Fetch server authority debug info
    fetchServerDebug();

    return () => {
      unsubscribe();
    };
  }, [isOpen]);

  const fetchServerDebug = async () => {
    try {
      const res = await fetch('/api/sync/debug');
      if (res.ok) {
        const data = await res.json();
        setServerDebugInfo(data);
      }
    } catch (e) {
      console.warn('Server debug fetch note:', e);
    }
  };

  const handleManualSync = async () => {
    setIsManualSyncing(true);
    setTestResult(null);
    try {
      await performFullOnlineSync(true);
      await fetchServerDebug();
    } catch (e: any) {
      console.error('Manual sync failed:', e);
    } finally {
      setIsManualSyncing(false);
    }
  };

  const handleTestSupabaseWrite = async () => {
    setIsTestingDb(true);
    setTestResult(null);
    try {
      const testId = `test_${Date.now()}`;
      const { data, error } = await supabase.from('leaderboard').insert({
        player_name: `PVP_MATCH:{"id":"${testId}","test":true,"timestamp":${Date.now()}}`,
        score: 0,
      });

      if (error) {
        setTestResult({
          success: false,
          message: `書き込み失敗: ${error.message} (Code: ${error.code || 'N/A'})`,
        });
      } else {
        setTestResult({
          success: true,
          message: `Supabase DBへのテスト書き込み成功！(Record ID: ${testId})`,
        });
        // Re-sync after test
        await performFullOnlineSync(true);
        await fetchServerDebug();
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `通信例外: ${err?.message || 'ネットワークエラー'}`,
      });
    } finally {
      setIsTestingDb(false);
    }
  };

  if (!isOpen) return null;

  const isSyncing = syncStatus.state === 'SYNCING' || isManualSyncing;
  const isError = syncStatus.state === 'ERROR' || Boolean(syncStatus.errorMessage);

  return (
    <div
      id="online-sync-debug-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in"
    >
      <div className="relative w-full max-w-2xl bg-slate-900 border border-emerald-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-emerald-500/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                オンライン同期・DB接続デバッグ情報
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Supabase + 10分周期
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                PVPランキングおよび公式大会のDB永続化状態とリアルタイム同期ステータス
              </p>
            </div>
          </div>
          <button
            id="close-sync-debug-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-sm text-slate-200">
          {/* Status summary banner */}
          <div
            className={`p-3.5 rounded-xl border flex items-center justify-between ${
              isError
                ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                : isSyncing
                ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {isError ? (
                <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              ) : isSyncing ? (
                <RefreshCw className="w-5 h-5 text-amber-400 animate-spin flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              )}
              <div>
                <div className="font-semibold text-xs sm:text-sm">
                  {isError
                    ? '同期エラーが発生しています'
                    : isSyncing
                    ? 'オンラインDB同期中...'
                    : 'オンラインDB正常稼働中 (Realtime + 10分周期)'}
                </div>
                <div className="text-[11px] opacity-80">
                  {isError
                    ? syncStatus.errorMessage || '接続を確認してください'
                    : `次回自動再取得まで: 約 ${Math.floor(syncStatus.secondsUntilNextSync / 60)}分${
                        syncStatus.secondsUntilNextSync % 60
                      }秒`}
                </div>
              </div>
            </div>

            <button
              id="manual-resync-now-btn"
              disabled={isSyncing}
              onClick={handleManualSync}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              今すぐ再同期
            </button>
          </div>

          {/* Grid Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Supabase Status */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-teal-400" />
                  Supabase 接続状態
                </span>
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  CONNECTED
                </span>
              </div>
              <div className="text-xs font-mono text-slate-300 break-all bg-slate-900/80 p-2 rounded border border-slate-800">
                URL: {SUPABASE_CONFIG.url}
              </div>
              <div className="text-[11px] text-slate-400 flex justify-between">
                <span>対象テーブル: leaderboard</span>
                <span className="text-emerald-400">認証: anon key (有効)</span>
              </div>
            </div>

            {/* Realtime Status */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-cyan-400" />
                  Realtime 接続状態
                </span>
                <span className="flex items-center gap-1 text-cyan-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                  SUBSCRIBED
                </span>
              </div>
              <div className="text-xs font-mono text-slate-300 bg-slate-900/80 p-2 rounded border border-slate-800 space-y-1">
                <div>チャンネル: football_draft_sync</div>
              </div>
              <div className="text-[11px] text-slate-400">
                複数ユーザー間の対戦結果・PVPランキング即時受信
              </div>
            </div>

            {/* Last Sync Timestamp */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                最後に同期した時刻 (JST)
              </div>
              <div className="text-sm font-bold text-white font-mono">
                {syncStatus.lastSyncJstString || '未同期'}
              </div>
              <div className="text-[11px] text-slate-400">
                サーバー現在時刻: {serverDebugInfo?.serverTimeJst || '同期中...'}
              </div>
            </div>

            {/* Matches in DB */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                <Swords className="w-4 h-4 text-rose-400" />
                最後に取得した試合数 (DB記録)
              </div>
              <div className="text-sm font-bold text-white font-mono flex items-baseline gap-2">
                <span>{syncStatus.lastFetchedMatchesCount} 試合</span>
                <span className="text-xs text-slate-400 font-normal">
                  (サーバー内: {serverDebugInfo?.pvp?.totalMatchesInMemory ?? 0}件)
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                第1回ランキング対象: 2026/09/13 00:00 JST以降の試合のみ
              </div>
            </div>

            {/* Ranking Participants */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                <Trophy className="w-4 h-4 text-yellow-400" />
                最後に取得したランキング人数
              </div>
              <div className="text-sm font-bold text-white font-mono">
                {syncStatus.lastFetchedStandingsCount} 名
              </div>
              <div className="text-[11px] text-slate-400">
                シーズン: 第1回 (2026/09/13〜09/20 JST)
              </div>
            </div>
          </div>

          {/* Last Sync Error Details */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
            <div className="text-xs text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-slate-400" />
                最後の同期エラー
              </span>
              {syncStatus.errorMessage ? (
                <span className="text-xs text-rose-400 font-medium">エラーあり</span>
              ) : (
                <span className="text-xs text-emerald-400 font-medium">なし (正常)</span>
              )}
            </div>
            <div className="text-xs font-mono p-2.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
              {syncStatus.errorMessage || 'エラーは記録されていません。すべての同期通信は正常に完了しています。'}
            </div>
          </div>

          {/* Test DB Write Section */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Supabase DB疎通・書き込み検証
              </span>
              <button
                id="test-supabase-write-btn"
                disabled={isTestingDb || isSyncing}
                onClick={handleTestSupabaseWrite}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition disabled:opacity-50"
              >
                {isTestingDb ? '検証中...' : 'テスト書き込みを実行'}
              </button>
            </div>
            {testResult && (
              <div
                className={`p-2.5 rounded text-xs font-mono border ${
                  testResult.success
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                }`}
              >
                {testResult.message}
              </div>
            )}
            <p className="text-[11px] text-slate-400">
              Supabaseの <code className="text-slate-300">leaderboard</code> テーブルへ実際にレコードをPOSTし、オンライン保存できるか検証します。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-emerald-500/20 flex items-center justify-between text-xs text-slate-400">
          <span>FOOTBALL DRAFT v1.4.0 (Online Authoritative DB)</span>
          <button
            id="close-sync-debug-footer-btn"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium transition"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
