/**
 * 数字・記号タイピング練習の出題(D-092)。
 *
 * 日本語のかな文とは別に、数字と記号だけを反復する場がどこにも無いため用意した。
 * 出題は実務で実際に打つ形（電話番号、金額、日付、メールアドレス、パスなど）に寄せる。
 * 意味のない乱数列を打たせても、実際の入力速度には結びつかない。
 */

export interface CharPrompt {
  /** 打つ文字列。表示もこのまま */
  text: string;
  /** 何を打っているかの説明。画面に添える */
  label: string;
}

export const NUMBER_PROMPTS: readonly CharPrompt[] = [
  { text: "090-1234-5678", label: "携帯電話番号" },
  { text: "03-6205-4417", label: "固定電話番号" },
  { text: "150-0043", label: "郵便番号" },
  { text: "2026/07/28", label: "日付" },
  { text: "12,800", label: "金額" },
  { text: "1,048,576", label: "桁区切りの数値" },
  { text: "0120-117-250", label: "フリーダイヤル" },
  { text: "3.14159265", label: "小数" },
  { text: "2025-01-31", label: "ハイフン区切りの日付" },
  { text: "98765 43210", label: "連番" },
  { text: "1234567890", label: "最上段の通し打ち" },
  { text: "45.6kg 172.3cm", label: "単位つきの数値" },
];

export const SYMBOL_PROMPTS: readonly CharPrompt[] = [
  { text: "user@example.com", label: "メールアドレス" },
  { text: "https://type-burst.com/", label: "URL" },
  { text: "(1) (2) (3)", label: "丸括弧" },
  { text: "[TODO] #urgent", label: "角括弧とハッシュ" },
  { text: "a_b-c.d", label: "区切り記号" },
  { text: "if (x >= 10) {", label: "比較演算子" },
  { text: "100% & 50%", label: "パーセントとアンパサンド" },
  { text: '"quoted" text', label: "ダブルクォート" },
  { text: "C:\\Users\\Docs", label: "バックスラッシュ" },
  { text: "key: value;", label: "コロンとセミコロン" },
  { text: "$1,200 +tax", label: "ドルとプラス" },
  { text: "Q&A / FAQ", label: "スラッシュ" },
];

export const MIXED_PROMPTS: readonly CharPrompt[] = [
  { text: "TEL: 03-1234-5678", label: "電話番号の記載" },
  { text: "2026/07/28 10:30", label: "日時" },
  { text: "order_no=A1029", label: "パラメータ" },
  { text: "¥3,980 (税込)", label: "価格表記" },
  { text: "v1.2.3-beta", label: "バージョン番号" },
  { text: "50% OFF!", label: "割引表記" },
  { text: "shou@type-burst.com", label: "メールアドレス" },
  { text: "#12345 [済]", label: "チケット番号" },
  { text: "A-1, B-2, C-3", label: "記号つきの一覧" },
  { text: "2024→2026", label: "年の推移" },
];

export type PracticeMode = "number" | "symbol" | "mixed";

export function promptsFor(mode: PracticeMode): readonly CharPrompt[] {
  if (mode === "number") return NUMBER_PROMPTS;
  if (mode === "symbol") return SYMBOL_PROMPTS;
  return MIXED_PROMPTS;
}

/**
 * 打ち間違えた文字を集計して、苦手な順に返す。
 * このツールの独自価値はここ。数字と記号のどれで詰まるかを可視化する。
 */
export function rankWeakChars(
  misses: Map<string, number>,
  attempts: Map<string, number>,
  limit = 3,
): Array<{ char: string; missCount: number; rate: number }> {
  const rows: Array<{ char: string; missCount: number; rate: number }> = [];
  for (const [char, missCount] of misses) {
    const tried = attempts.get(char) ?? 0;
    // 試行が少ない文字は偶然のミスで上位に来てしまうため除外する
    if (tried < 2) continue;
    rows.push({ char, missCount, rate: missCount / (tried + missCount) });
  }
  rows.sort((a, b) => b.rate - a.rate || b.missCount - a.missCount);
  return rows.slice(0, limit);
}
