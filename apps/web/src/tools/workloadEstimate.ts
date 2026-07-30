/**
 * タイピング速度から実務の所要時間を計算する(D-092)。
 *
 * 設計上の判断:
 * 当初は「タイピング検定レベル判定」を作る予定だったが、2つの理由で変更した。
 * 1. 既存の typing-speed-test が「レベル診断」を持っており、検索意図が重複する。
 * 2. 公的検定の合格基準を正確に検証できない。根拠のない数値を書くことになる。
 *
 * 代わりに、算数だけで成立する「所要時間の換算」にした。
 * 「事務職に必要な速度は◯◯」という出典のない基準は一切置かず、
 * 「あなたの速度なら、この作業に何分かかるか」だけを返す。
 * 十分かどうかの判断は利用者に委ねる。これは逃げではなく、
 * 根拠のない基準を断定しないための設計。
 */

export interface Task {
  id: string;
  name: string;
  /** 日本語の文字数(かな・漢字を含む表示上の文字数) */
  chars: number;
  note: string;
}

/**
 * 想定する作業。文字数は「その文書が一般にどれくらいの分量か」であり、
 * 必要な速度の基準ではない。
 */
export const TASKS: readonly Task[] = [
  { id: "chat", name: "チャットの返信1件", chars: 60, note: "短い連絡やSlackの返信" },
  { id: "mail", name: "業務メール1通", chars: 400, note: "宛名・本文・署名を含む標準的な長さ" },
  { id: "minutes", name: "会議の議事録", chars: 2000, note: "1時間の会議を要約した分量" },
  { id: "report", name: "報告書1本", chars: 4000, note: "A4で3〜4枚程度" },
  { id: "article", name: "記事・レポート", chars: 8000, note: "調査記事や卒論の1章" },
];

export interface Estimate {
  task: Task;
  /** 純粋な打鍵時間(分) */
  typingMinutes: number;
  /** 変換・推敲を含む現実的な時間(分) */
  realisticMinutes: number;
}

/**
 * 日本語1文字あたりのローマ字打鍵数。
 * かな1文字は多くが2打鍵(ka, shi など)、漢字は読みの分だけ打つため、
 * 一般的な日本語の文章ではおおよそ2打鍵/文字に近づく。
 * 正確な値は文章によって変わるため、あくまで概算であることを画面にも明記する。
 */
export const KEYSTROKES_PER_CHAR = 2;

/**
 * 実際の入力では変換・確定・推敲・考える時間が入るため、
 * 純粋な打鍵時間だけでは実態と合わない。
 * ここでは打鍵時間の2倍を現実的な目安として扱い、この前提を画面に明示する。
 */
export const REALISTIC_MULTIPLIER = 2;

export function estimateTasks(kpm: number): Estimate[] {
  if (!Number.isFinite(kpm) || kpm <= 0) return [];
  return TASKS.map((task) => {
    const typingMinutes = (task.chars * KEYSTROKES_PER_CHAR) / kpm;
    return {
      task,
      typingMinutes,
      realisticMinutes: typingMinutes * REALISTIC_MULTIPLIER,
    };
  });
}

/** 分を「◯分」「◯時間◯分」の読みやすい表記にする */
export function formatMinutes(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))}秒`;
  if (minutes < 60) return `${Math.round(minutes)}分`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}

/**
 * 速度を上げたとき、1日の作業時間がどれだけ減るかを示す。
 * 「速くなると何が嬉しいのか」を数値で答えられるのがこのツールの独自価値。
 */
export function dailySavings(
  currentKpm: number,
  targetKpm: number,
  charsPerDay: number,
): { currentMinutes: number; targetMinutes: number; savedMinutesPerDay: number; savedHoursPerYear: number } | null {
  if (currentKpm <= 0 || targetKpm <= 0 || charsPerDay <= 0) return null;
  const keystrokes = charsPerDay * KEYSTROKES_PER_CHAR;
  const currentMinutes = (keystrokes / currentKpm) * REALISTIC_MULTIPLIER;
  const targetMinutes = (keystrokes / targetKpm) * REALISTIC_MULTIPLIER;
  const savedMinutesPerDay = currentMinutes - targetMinutes;
  return {
    currentMinutes,
    targetMinutes,
    savedMinutesPerDay,
    // 年間の営業日を240日として概算する。前提は画面に明記する。
    savedHoursPerYear: (savedMinutesPerDay * 240) / 60,
  };
}
