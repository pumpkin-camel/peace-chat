import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Supabase URL / anon key は公開設定。Secrets には秘密鍵のみを置く。
const SUPABASE_URL = (
  process.env.SUPABASE_URL || 'https://supabase-api-prod.verdent.ai/p/p6db467b7e8f28b73b727'
).replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const app = express();
app.use(express.json({ limit: '1mb' }));

async function verifyAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/peace-convert', async (req, res) => {
  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const text = String(req.body?.text ?? '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'EMPTY_TEXT' });

  // 口調合わせ用: 送信者の過去メッセージ（フィルター前の原文を優先）
  const toneExamples = Array.isArray(req.body?.tone_examples)
    ? req.body.tone_examples
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => s.trim().slice(0, 200))
        .slice(0, 8)
    : [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'NO_API_KEY' });

  const baseUrl = (process.env.PEACE_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.PEACE_AI_MODEL || 'gpt-4o-mini';

  try {
    const aiRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'あなたは「平和フィルター」の判定・変換AIです。ユーザーの日本語メッセージを評価し、次の基準で判定してください。',
              '1. 暴言・攻撃的表現・きつい言葉・罵倒・からかい・不快感を与える表現が含まれる場合は "abusive": true とし、"text" に、意味と質問・依頼・主張の意図を保った平和で角のない日本語へ書き換えた結果を入れてください。表記ゆれ・皮肉・隠語も文脈から判断して暴言とみなしてください。',
              '2. 穏やかで普通的なメッセージの場合は "abusive": false とし、"text" は原文をそのまま入れてください（書き換えない）。',
              '3. 【最重要・口調合わせ】変換後の "text" は、後述する「ユーザーの過去の発言例」と同じ口調・カジュアルさ・語尾で書いてください。ユーザーがタメ口ならタメ口のまま、柔らかく砕けた表現で平和な内容にしてください。硬い「です・ます」の敬語には絶対にしないでください。攻撃的な部分だけを穏やかな言い回しに置き換え、それ以外はユーザー自身が書いたかのような自然さを目指してください。',
              toneExamples.length > 0
                ? `ユーザーの過去の発言例（口調の参考）:\n${toneExamples.map((s) => `- ${s}`).join('\n')}`
                : 'ユーザーの過去の発言例がない場合は、親しみやすい自然な口調で穏やかに書いてください。',
              '出力は必ず次のJSONのみ: {"abusive": true|false, "text": "処理後のメッセージ"}',
            ]
              .filter(Boolean)
              .join('\n'),
          },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!aiRes.ok) return res.status(502).json({ error: 'AI_REQUEST_FAILED' });
    const data = await aiRes.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    if (!raw) return res.status(502).json({ error: 'AI_EMPTY_RESPONSE' });

    let abusive = true;
    let output = raw;
    try {
      const parsed = JSON.parse(raw);
      abusive = Boolean(parsed.abusive);
      if (typeof parsed.text === 'string' && parsed.text.trim()) output = parsed.text.trim();
    } catch {
      // JSONで返らなかった場合は保守的に変換結果を採用
    }

    res.json({ text: abusive ? output : text, abusive });
  } catch {
    res.status(502).json({ error: 'AI_REQUEST_FAILED' });
  }
});

// 静的配信（ビルド済みフロントエンド）
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(dist, 'index.html'));
});

const port = Number(process.env.PORT || 8080);
app.listen(port, '0.0.0.0', () => {
  console.log(`peace-chat server listening on 0.0.0.0:${port}`);
});
