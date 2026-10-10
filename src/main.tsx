import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import './style.css';
import {
  auth,
  randomInviteCode,
  supabase,
  type ChatMessage,
  type Room,
} from './lib/supabase';
import { convertToPeace } from './lib/peaceClient';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type Theme = 'light' | 'dark' | 'neon';
const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'ライト' },
  { id: 'dark', label: 'ダーク' },
  { id: 'neon', label: 'ネオン' },
];

function nowTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function displayNameOf(session: Session): string {
  const meta = session.user.user_metadata ?? {};
  return (
    (typeof meta.name === 'string' && meta.name) ||
    (typeof meta.full_name === 'string' && meta.full_name) ||
    session.user.email?.split('@')[0] ||
    'ゲスト'
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [myName, setMyName] = useState('ゲスト');

  const [peaceOn, setPeaceOn] = useState(() => localStorage.getItem('peace-filter') !== 'off');
  const [theme, setTheme] = useState<Theme>(() => {
    const t = localStorage.getItem('peace-theme');
    return t === 'dark' || t === 'neon' ? t : 'light';
  });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [newRoomOpen, setNewRoomOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [loadingRoom, setLoadingRoom] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const roomRef = useRef<string | null>(null);
  roomRef.current = roomId;
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    localStorage.setItem('peace-filter', peaceOn ? 'on' : 'off');
  }, [peaceOn]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('peace-theme', theme);
  }, [theme]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setRooms([]);
      setRoomId(null);
      setMessages([]);
      return;
    }
    setMyName(displayNameOf(session));
    bootstrap(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    if (!roomId) return;
    loadMessages(roomId);
    const channel = supabase
      .channel(`room-${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const row = payload.new as ChatMessage;
          setMessages((m) => (m.some((x) => x.id === row.id) ? m : [...m, row]));
        },
      )
      .subscribe();

    // Realtime が使えない環境向けのフォールバック定期ポーリング
    const poll = window.setInterval(async () => {
      if (document.hidden || roomRef.current !== roomId) return;
      const current = messagesRef.current.filter((x) => !x.id.startsWith('tmp-'));
      const last = current[current.length - 1]?.created_at;
      if (!last) return;
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .gt('created_at', last)
        .order('created_at', { ascending: true })
        .limit(50);
      if (data?.length) {
        setMessages((m) => {
          const known = new Set(m.map((x) => x.id));
          const fresh = (data as ChatMessage[]).filter((x) => !known.has(x.id));
          return fresh.length ? [...m, ...fresh] : m;
        });
      }
    }, 4000);

    return () => {
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2600);
  };

  async function bootstrap(s: Session) {
    const uid = s.user.id;
    const name = displayNameOf(s);
    // プロフィール登録（ベストエフォート）
    await supabase.from('profiles').upsert({ id: uid, display_name: name });

    // 招待リンクからの参加
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    let joinedId: string | null = null;
    if (invite) {
      const { data } = await supabase.rpc('join_room_with_code', { p_code: invite });
      if (typeof data === 'string') joinedId = data;
      window.history.replaceState(null, '', window.location.pathname);
    }

    const { data: myRooms } = await supabase
      .from('rooms')
      .select('*')
      .order('created_at', { ascending: true });
    let list = (myRooms ?? []) as Room[];

    if (joinedId && !list.some((r) => r.id === joinedId)) {
      const { data: joinedRoom } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', joinedId)
        .maybeSingle();
      if (joinedRoom) list = [...list, joinedRoom as Room];
    }

    if (list.length === 0) {
      await createRoom('平和な部屋', uid);
      return;
    }

    setRooms(list);
    setRoomId(joinedId ?? list[0].id);
  }

  async function createRoom(name: string, uid: string) {
    const { data: room, error } = await supabase
      .from('rooms')
      .insert({ name, invite_code: randomInviteCode(), created_by: uid })
      .select()
      .single();
    if (error || !room) {
      console.error('createRoom failed', error);
      showToast(`部屋を作成できませんでした${error?.message ? `（${error.message}）` : ''}`);
      return null;
    }
    await supabase.from('room_members').insert({ room_id: room.id, user_id: uid });
    setRooms((r) => [...r, room as Room]);
    setRoomId(room.id);
    return room as Room;
  }

  async function loadMessages(id: string) {
    setLoadingRoom(true);
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', id)
      .order('created_at', { ascending: true })
      .limit(200);
    setMessages((data ?? []) as ChatMessage[]);
    setLoadingRoom(false);
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || !session || !roomId || sending) return;
    setSending(true);
    setDraft('');

    let content = text;
    let original: string | undefined;
    let filtered = false;

    if (peaceOn) {
      // 口調サンプル: 自分の過去メッセージ（フィルター前の原文を優先）を新しい順に最大8件
      const toneExamples = [...messagesRef.current]
        .reverse()
        .filter((m) => m.user_id === session.user.id && !m.id.startsWith('tmp-'))
        .map((m) => m.original_content || m.content)
        .filter((t): t is string => Boolean(t && t.trim()) && !t.startsWith('📷'))
        .slice(0, 8);

      const converted = await convertToPeace(text, toneExamples);
      // AI/ルールが「暴言」と判定したときだけ平和変換して送信。
      // 普通の文章と判定された場合は原文のまま送る。
      if (converted?.abusive) {
        content = converted.text;
        original = text;
        filtered = true;
      }
    }

    // 楽観的に即時表示（AI変換後の内容で表示）
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const temp: ChatMessage = {
      id: tempId,
      room_id: roomId,
      user_id: session.user.id,
      sender_name: myName,
      content,
      original_content: original ?? null,
      filtered,
      image_url: null,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, temp]);

    const { data } = await supabase
      .from('messages')
      .insert({
        room_id: roomId,
        user_id: session.user.id,
        sender_name: myName,
        content,
        original_content: original,
        filtered,
      })
      .select()
      .single();

    if (data) {
      const row = data as ChatMessage;
      setMessages((m) => m.map((x) => (x.id === tempId ? row : x)));
    }
    setSending(false);
  }

  async function sendImage(file: File) {
    if (!session || !roomId) return;
    if (file.size > MAX_IMAGE_BYTES) {
      showToast('画像は5MBまでです');
      return;
    }
    setUploading(true);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'png'}`;
    const { error } = await supabase.storage.from('chat-images').upload(path, file);
    if (error) {
      showToast('画像をアップロードできませんでした');
      setUploading(false);
      return;
    }
    const { data: pub } = supabase.storage.from('chat-images').getPublicUrl(path);

    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const temp: ChatMessage = {
      id: tempId,
      room_id: roomId,
      user_id: session.user.id,
      sender_name: myName,
      content: '📷 画像を送信しました',
      original_content: null,
      filtered: false,
      image_url: pub.publicUrl,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, temp]);

    const { data } = await supabase
      .from('messages')
      .insert({
        room_id: roomId,
        user_id: session.user.id,
        sender_name: myName,
        content: '📷 画像を送信しました',
        image_url: pub.publicUrl,
      })
      .select()
      .single();

    if (data) {
      const row = data as ChatMessage;
      setMessages((m) => m.map((x) => (x.id === tempId ? row : x)));
    }
    setUploading(false);
  }

  const inviteLink = useCallback(() => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    const url = `${window.location.origin}${window.location.pathname}?invite=${room.invite_code}`;
    navigator.clipboard
      .writeText(url)
      .then(() => showToast('招待リンクをコピーしました。友達や家族に送ってください'))
      .catch(() => showToast(url));
  }, [rooms, roomId]);

  if (!authReady) {
    return (
      <div className='scene'>
        <p className='loading-text'>読み込み中…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className='scene'>
        <div className='blob blob-a' aria-hidden='true' />
        <div className='blob blob-b' aria-hidden='true' />
        <div className='blob blob-c' aria-hidden='true' />
        <div className='signin-card'>
          <div className='signin-logo'>🕊️</div>
          <h1 className='signin-title'>Peace Chat</h1>
          <p className='signin-copy'>
            暴言を平和な言葉に変える、やさしいチャット。
            <br />
            友達や家族を招待して、穏やかなお話を始めましょう。
          </p>
          <button className='signin-btn' onClick={() => auth.openSignInModal()}>
            ログイン / 新規登録
          </button>
        </div>
      </div>
    );
  }

  const currentRoom = rooms.find((r) => r.id === roomId);

  return (
    <div className='scene'>
      <div className='blob blob-a' aria-hidden='true' />
      <div className='blob blob-b' aria-hidden='true' />
      <div className='blob blob-c' aria-hidden='true' />

      <div className='mac-window'>
        <header className='titlebar'>
          <div className='title-group'>
            <h1 className='window-title'>{currentRoom?.name ?? 'Peace Chat'}</h1>
            <span className='window-sub'>
              {currentRoom ? `招待コード: ${currentRoom.invite_code}` : '平和フィルター搭載チャット'}
            </span>
          </div>
          <button className='ghost-btn' onClick={inviteLink} disabled={!currentRoom}>
            招待
          </button>

          <div className='theme-dots' role='group' aria-label='テーマ切り替え'>
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-dot ${t.id} ${theme === t.id ? 'active' : ''}`}
                onClick={() => setTheme(t.id)}
                title={t.label}
                aria-label={`テーマ: ${t.label}`}
              />
            ))}
          </div>

          <label className={`peace-toggle ${peaceOn ? 'on' : ''}`}>
            <input
              type='checkbox'
              checked={peaceOn}
              onChange={(e) => setPeaceOn(e.target.checked)}
              aria-label='平和フィルターを切り替える'
            />
            <span className='toggle-track'>
              <span className='toggle-knob'>
                <span className='toggle-face'>{peaceOn ? '🕊️' : '💬'}</span>
              </span>
            </span>
            <span className='toggle-label'>
              <span className='toggle-title'>平和フィルター</span>
              <span className={`toggle-state ${peaceOn ? 'state-on' : 'state-off'}`}>
                {peaceOn ? 'ON' : 'OFF'}
              </span>
            </span>
          </label>
        </header>

        <div className='room-bar'>
          {rooms.map((r) => (
            <button
              key={r.id}
              className={`room-chip ${r.id === roomId ? 'active' : ''}`}
              onClick={() => setRoomId(r.id)}
            >
              {r.name}
            </button>
          ))}
          <button
            className='room-chip add'
            onClick={() => {
              setNewRoomName('');
              setNewRoomOpen(true);
            }}
          >
            ＋ 新しい部屋
          </button>
          <span className='room-bar-spacer' />
          <span className='me-chip'>{myName}</span>
          <button className='ghost-btn small' onClick={() => supabase.auth.signOut()}>
            ログアウト
          </button>
        </div>

        <div className={`filter-banner ${peaceOn ? 'on' : 'off'}`} role='status'>
          {peaceOn
            ? '🕊️ AIが暴言を自動判定し、平和な言葉に変換して送信されます'
            : '💬 フィルターはOFFです。入力した言葉がそのまま届きます'}
        </div>

        <div className='chat-area' ref={scrollRef}>
          {loadingRoom && <p className='loading-text'>読み込み中…</p>}
          {!loadingRoom && messages.length === 0 && (
            <p className='loading-text'>
              まだメッセージがありません。
              <br />
              「招待」ボタンから友達や家族を誘ってみましょう。
            </p>
          )}
          {messages.map((m) => (
            <ChatBubble key={m.id} message={m} mine={m.user_id === session.user.id} />
          ))}
          {sending && (
            <div className='row me'>
              <div className='bubble me typing'>
                <span className='dot' />
                <span className='dot' />
                <span className='dot' />
              </div>
            </div>
          )}
        </div>

        <footer className='composer'>
          <input
            ref={fileRef}
            type='file'
            accept='image/*'
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) sendImage(f);
              e.target.value = '';
            }}
          />
          <button
            className='icon-btn'
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label='画像を送信'
            title='画像を送信'
          >
            🖼
          </button>
          <input
            className='composer-input'
            placeholder='メッセージを入力…'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          <button
            className='send-btn'
            onClick={() => send(draft)}
            disabled={!draft.trim() || sending}
            aria-label='送信'
          >
            ↑
          </button>
        </footer>
      </div>

      {newRoomOpen && (
        <div className='modal-backdrop' onClick={() => setNewRoomOpen(false)}>
          <div className='modal-card' onClick={(e) => e.stopPropagation()}>
            <h2 className='modal-title'>新しい部屋を作る</h2>
            <input
              className='composer-input'
              autoFocus
              placeholder='部屋の名前（例：家族の部屋）'
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setNewRoomOpen(false);
                  createRoom(newRoomName.trim() || '平和な部屋', session.user.id);
                }
              }}
            />
            <div className='modal-actions'>
              <button className='ghost-btn' onClick={() => setNewRoomOpen(false)}>
                キャンセル
              </button>
              <button
                className='primary-btn'
                onClick={() => {
                  setNewRoomOpen(false);
                  createRoom(newRoomName.trim() || '平和な部屋', session.user.id);
                }}
              >
                作成
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className='toast'>{toast}</div>}
    </div>
  );
}

async function downloadImage(url: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `peace-chat-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch {
    window.open(url, '_blank');
  }
}

function ChatBubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const [showOriginal, setShowOriginal] = useState(false);

  return (
    <div className={`row ${mine ? 'me' : 'bot'}`}>
      <div className={`bubble ${mine ? 'me' : 'bot'}`}>
        {!mine && <span className='sender-name'>{message.sender_name}</span>}
        {message.image_url && (
          <div className='img-wrap'>
            <img
              className='bubble-image'
              src={message.image_url}
              alt='送信された画像'
              onClick={() => window.open(message.image_url!, '_blank')}
            />
            <button
              className='img-dl'
              onClick={() => downloadImage(message.image_url!)}
              aria-label='画像をダウンロード'
              title='画像をダウンロード'
            >
              ⤓
            </button>
          </div>
        )}
        <p className='bubble-text'>{message.content}</p>
        {message.filtered && (
          <div className='filter-note'>
            <span className='peace-badge'>
              🕊️ {mine ? 'AI平和変換済み' : '平和フィルター変換済み'}
            </span>
            {mine && message.original_content && (
              <button className='original-toggle' onClick={() => setShowOriginal((v) => !v)}>
                {showOriginal ? '原文を隠す' : '原文を見る'}
              </button>
            )}
          </div>
        )}
        {showOriginal && message.original_content && (
          <p className='original-text'>原文：{message.original_content}</p>
        )}
        <span className='bubble-time'>{nowTime(message.created_at)}</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
