import { createClient } from '@supabase/supabase-js';

const defaultUrl = 'https://ihaiadukjycjdvaownpv.supabase.co';
const defaultKey = 'sb_publishable_dEjgitW3rRtpyGnqaIFeZg_2ZONcI-l';

const rawUrl = import.meta.env?.VITE_SUPABASE_LEADERBOARD_URL || import.meta.env?.VITE_SUPABASE_URL;
const rawKey = import.meta.env?.VITE_SUPABASE_LEADERBOARD_KEY || import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabaseUrl =
  typeof rawUrl === 'string' && rawUrl.startsWith('http')
    ? rawUrl
    : defaultUrl;

const supabaseKey =
  typeof rawKey === 'string' && rawKey.length > 0
    ? rawKey
    : defaultKey;

export const SUPABASE_CONFIG = {
  url: supabaseUrl,
  anonKey: supabaseKey,
  table: 'leaderboard',
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
