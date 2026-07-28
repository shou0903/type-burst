/**
 * 共有カードの中身と、SNSへ投稿する文面を組み立てる(D-091)。
 *
 * 文面の方針:
 * - 絵文字でスコアを図案化する案(Wordleのマス目のような表現)は採らない。
 *   連鎖した属性の並びは summary に残っていないため、それらしい絵を作ると
 *   実際のプレイと無関係な模様を「記録」として出すことになる。
 *   画像カードという確かな見せ札がある以上、文面は正確さを優先する。
 * - 1行目でモードと難易度、2行目で主役の数値、3行目で内訳。
 *   タイムライン上では2行目までしか読まれない前提で並べている。
 */

import type { DuelSummary, SurvivalDifficulty, SurvivalSummary } from "@type-burst/game-core";
import type { ShareAccent, ShareCardData } from "./shareCard";

export interface ShareContent {
  card: ShareCardData;
  /** X の投稿本文(URLは別パラメータで付く) */
  text: string;
  /** OGP用。リンクカードのタイトルとして表示される */
  ogTitle: string;
  ogDescription: string;
}

const SURVIVAL_LABELS: Record<SurvivalDifficulty, string> = {
  easy: "初級",
  normal: "中級",
  hard: "上級",
  god: "神級",
};

const SURVIVAL_ACCENTS: Record<SurvivalDifficulty, ShareAccent> = {
  easy: "wind",
  normal: "water",
  hard: "light",
  god: "fire",
};

const CPU_LABELS = { easy: "弱い", normal: "普通", hard: "強い" } as const;

const TAGLINE = "打ち切ったブロックが爆発する日本語タイピングゲーム💥";
const HASHTAG = "#TYPEBURST";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------------------
// サバイバル
// ------------------------------------------------------------------

export function buildSurvivalShare(
  summary: SurvivalSummary,
  rank: string,
  nickname: string | null,
): ShareContent {
  const difficulty = SURVIVAL_LABELS[summary.difficulty];
  const score = summary.score.toLocaleString();

  return {
    card: {
      eyebrow: "SURVIVAL",
      eyebrowSub: difficulty,
      accent: SURVIVAL_ACCENTS[summary.difficulty],
      badgeLabel: "RANK",
      badgeValue: rank,
      headline: score,
      headlineLabel: "FINAL SCORE",
      stats: [
        { label: "最大連鎖", value: String(summary.maxChain) },
        { label: "KPM", value: String(summary.kpm) },
        { label: "正確率", value: percent(summary.accuracy) },
        { label: "生存時間", value: formatTime(summary.survivedMs) },
      ],
      nickname,
    },
    text: [
      `TYPE BURST［${difficulty}］`,
      `スコア ${score} ／ RANK ${rank}`,
      `最大${summary.maxChain}連鎖・KPM ${summary.kpm}・正確率 ${percent(summary.accuracy)}`,
      "",
      TAGLINE,
      HASHTAG,
    ].join("\n"),
    ogTitle: `${nickname ? `${nickname}さん・` : ""}スコア ${score}（${difficulty} / RANK ${rank}）`,
    ogDescription: `最大${summary.maxChain}連鎖・KPM ${summary.kpm}・正確率 ${percent(
      summary.accuracy,
    )}。TYPE BURSTは登録不要で遊べる無料タイピングゲームです。`,
  };
}

// ------------------------------------------------------------------
// デイリーチャレンジ
// ------------------------------------------------------------------

export interface DailyShareInput {
  summary: SurvivalSummary;
  challengeId: string;
  nickname: string | null;
  streak: number;
  viewer: { rank: number; total: number; percentile: number } | null;
}

export function buildDailyShare({
  summary,
  challengeId,
  nickname,
  streak,
  viewer,
}: DailyShareInput): ShareContent {
  const score = summary.score.toLocaleString();
  const stats = [
    { label: "最大連鎖", value: String(summary.maxChain) },
    { label: "KPM", value: String(summary.kpm) },
    { label: "正確率", value: percent(summary.accuracy) },
  ];
  if (streak > 0) stats.push({ label: "連続", value: `${streak}日` });

  // 順位が取れていればバッジは順位を出す。デイリーは「全員同じ問題」が
  // 売りなので、単独のスコアより順位のほうが共有の動機として強い。
  const badge = viewer
    ? { label: "本日", value: `${viewer.rank}位` }
    : { label: "DAILY", value: "完走" };

  const rankLine = viewer
    ? `スコア ${score} ／ ${viewer.rank}位（上位${viewer.percentile.toFixed(1)}%）`
    : `スコア ${score}`;

  return {
    card: {
      eyebrow: "DAILY",
      eyebrowSub: challengeId,
      accent: "light",
      badgeLabel: badge.label,
      badgeValue: badge.value,
      headline: score,
      headlineLabel: "TODAY'S SCORE",
      stats,
      nickname,
    },
    text: [
      "TYPE BURST 今日のデイリーチャレンジ",
      rankLine,
      streak > 0 ? `🔥 ${streak}日連続` : "",
      "",
      "全員が同じ問題に挑む2分勝負。あなたは何位？",
      HASHTAG,
    ]
      .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
      .join("\n"),
    ogTitle: `${nickname ? `${nickname}さん・` : ""}${
      viewer ? `本日${viewer.rank}位` : "デイリーチャレンジ"
    } スコア ${score}`,
    ogDescription: `${challengeId}のデイリーチャレンジ。全員が同じ問題に挑む2分勝負です。TYPE BURSTは登録不要で遊べる無料タイピングゲーム。`,
  };
}

// ------------------------------------------------------------------
// CPU対戦
// ------------------------------------------------------------------

export function buildDuelShare(summary: DuelSummary, nickname: string | null): ShareContent {
  const opponent = CPU_LABELS[summary.difficulty];
  const score = summary.player.score.toLocaleString();
  const outcome = summary.won ? "WIN" : "LOSE";

  return {
    card: {
      eyebrow: "CPU BATTLE",
      eyebrowSub: opponent,
      accent: summary.won ? "fire" : "water",
      badgeLabel: "RESULT",
      badgeValue: outcome,
      headline: score,
      headlineLabel: "YOUR SCORE",
      stats: [
        { label: "最大連鎖", value: String(summary.player.maxChain) },
        { label: "KPM", value: String(summary.player.kpm) },
        { label: "正確率", value: percent(summary.player.accuracy) },
        { label: "CPUスコア", value: summary.cpu.score.toLocaleString() },
      ],
      nickname,
    },
    text: [
      `TYPE BURST CPU対戦［${opponent}］に${summary.won ? "勝利" : "敗北"}`,
      `スコア ${score} ／ 最大${summary.player.maxChain}連鎖・KPM ${summary.player.kpm}`,
      "",
      TAGLINE,
      HASHTAG,
    ].join("\n"),
    ogTitle: `${nickname ? `${nickname}さん・` : ""}CPU対戦［${opponent}］${
      summary.won ? "勝利" : "敗北"
    } スコア ${score}`,
    ogDescription: `最大${summary.player.maxChain}連鎖・KPM ${summary.player.kpm}。TYPE BURSTは登録不要で遊べる無料タイピングゲームです。`,
  };
}
