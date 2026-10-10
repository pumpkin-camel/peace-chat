import { createClient } from '@supabase/supabase-js';
import { createVerdentAuth } from '@verdent/auth-js';

// Verdent プレビュー / 公開環境では同一起源の BaaS プロキシを優先。
// ローカル開発では注入された公開設定（VITE_*）を直接使う。
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || window.location.origin;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'verdent-baas-proxy';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const auth = createVerdentAuth({
  supabase,
  oauth: import.meta.env.VITE_VERDENT_OAUTH_INITIATE_URL
    ? { authorizeUrl: import.meta.env.VITE_VERDENT_OAUTH_INITIATE_URL }
    : undefined,
});

export interface Room {
  id: string;
  name: string;
  invite_code: string;
  created_by: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  user_id: string;
  sender_name: string;
  content: string;
  original_content: string | null;
  filtered: boolean;
  image_url: string | null;
  created_at: string;
}

export function randomInviteCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}
