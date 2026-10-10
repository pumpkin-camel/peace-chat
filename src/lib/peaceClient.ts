import { applyPeaceFilter } from '../peaceFilter';
import { supabase } from './supabase';

export interface PeaceConversion {
  text: string;
  /** AIまたはルール判定で「暴言だった」とき true */
  abusive: boolean;
  /** 判定元: true = AI, false = ローカルルール */
  ai: boolean;
}

/**
 * AI（サーバー側 /api/peace-convert）に暴言判定と平和変換を依頼し、
 * 失敗した場合はローカルのルールベース変換にフォールバックする。
 * - AI判定: 暴言なら変換後テキスト（abusive: true）、普通の文章なら原文（abusive: false）
 * - AI不可: ルールに一致すれば変換（abusive: true）、しなければ null（そのまま送信）
 */
export async function convertToPeace(
  text: string,
  toneExamples: string[] = [],
): Promise<PeaceConversion | null> {
  const aiResult = await aiConvert(text, toneExamples);
  if (aiResult) return { text: aiResult.text, abusive: aiResult.abusive, ai: true };

  const local = applyPeaceFilter(text, true);
  if (local.filtered) return { text: local.text, abusive: true, ai: false };
  return null;
}

async function aiConvert(
  text: string,
  toneExamples: string[],
): Promise<{ text: string; abusive: boolean } | null> {
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) return null;

    const res = await fetch('/api/peace-convert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text, tone_examples: toneExamples }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string; abusive?: boolean };
    if (typeof data.text !== 'string' || !data.text.trim()) return null;
    return { text: data.text.trim(), abusive: Boolean(data.abusive) };
  } catch {
    return null;
  }
}
