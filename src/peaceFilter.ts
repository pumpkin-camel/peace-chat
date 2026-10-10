export interface PeaceResult {
  text: string;
  filtered: boolean;
  hits: string[];
}

interface PeaceRule {
  pattern: RegExp;
  replacement: string;
}

/**
 * 暴言・強い言葉を超丁寧な平和な言葉へ変換するルール一覧。
 * ひらがな・カタカナ・漢字のゆらぎをまとめて拾う。
 */
const RULES: PeaceRule[] = [
  {
    pattern: /ふざけんな|ふざけるな|フザケンナ|ふざけんなって/g,
    replacement: 'もう少し落ち着いてお話ししませんか？',
  },
  {
    pattern: /死ね|しね|シネ|死んだらいいのに/g,
    replacement: 'お互い、どうか穏やかに過ごせますように。',
  },
  {
    pattern: /ばーか|バーカ|バカ|ばか|馬鹿/g,
    replacement: 'あなたなら分かってくれるはずです',
  },
  {
    pattern: /うざい|ウザイ|うぜえ|うぜー|ウゼー/g,
    replacement: '少し距離を置いて考えさせてください',
  },
  {
    pattern: /きもい|キモい|キモイ|気持ち悪い/g,
    replacement: '少し気になるところがあるのですが、ご容赦ください',
  },
  {
    pattern: /消えろ|きえろ|消えてくれ|失せろ/g,
    replacement: '今日はそっとしておいていただけますか',
  },
  {
    pattern: /黙れ|だまれ|黙って/g,
    replacement: '申し訳ありませんが、少し口を挟ませてください',
  },
  {
    pattern: /くそ|クソ|糞/g,
    replacement: 'うーん、うまくいかないものですね',
  },
  {
    pattern: /アホ|あほ|阿呆|あほう/g,
    replacement: '私の説明が足りなかったかもしれません',
  },
  {
    pattern: /まぬけ|マヌケ|たわけ|間抜け/g,
    replacement: 'お恥ずかしいところをお見せしてしまいました',
  },
  {
    pattern: /ゴミ|ごみ/g,
    replacement: '期待外れでしたね。改善を心がけます',
  },
  {
    pattern: /クズ|くず|カス/g,
    replacement: 'まだまだ未熟なもので、ご指導ください',
  },
  {
    pattern: /ダサい|だせえ|ダセエ/g,
    replacement: 'もっと良い方法がありそうですね',
  },
  {
    pattern: /しつこい|ウルサイ|うるさい/g,
    replacement: '後ほど改めてご連絡させていただきます',
  },
  {
    pattern: /はぁ？|はあ？|ハァ？|は？何/g,
    replacement: 'もう一度、丁寧にご説明いただけますか？',
  },
  {
    pattern: /勘違いしてんじゃねえ|勘違いするな|わかってねえな/g,
    replacement: '認識のズレがあるようなので、整理させてください',
  },
];

/** フィルタOFF時の素通り用に、見た目はそのまま返す */
export function applyPeaceFilter(input: string, enabled: boolean): PeaceResult {
  if (!enabled) {
    return { text: input, filtered: false, hits: [] };
  }

  let text = input;
  const hits: string[] = [];

  for (const rule of RULES) {
    const found = input.match(rule.pattern);
    if (found) {
      hits.push(...found);
      text = text.replace(new RegExp(rule.pattern.source, 'g'), rule.replacement);
    }
  }

  if (hits.length > 0) {
    // 変換後に語尾を整えて、自然な丁寧文に仕上げる
    text = polishTail(text);
  }

  return { text, filtered: hits.length > 0, hits };
}

function polishTail(text: string): string {
  // すでに「？」や「。」で終わっていればそのまま
  if (/[？?！!。♪～]$/.test(text.trim())) return text;
  return `${text.replace(/[、,]+$/, '')} よろしくお願いいたします。`;
}

/** ラベル用のヒントキーワード */
export const SAMPLE_WORDS = ['ふざけんな', 'バカ', 'うざい', 'きもい'];
