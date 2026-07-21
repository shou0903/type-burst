import type { Attribute } from "@type-burst/game-core";

/**
 * 盤面カラーテーマ(アンロック要素、D-055)。称号システム(titles.ts)と同じ
 * 累計スコアを解放条件に使うことで、進捗指標を1つに保ち「この称号で新しい
 * 配色も解放される」という分かりやすい連動を作る。ゲームロジックには一切
 * 影響しない、純粋な見た目のカスタマイズ。
 */
export type BoardThemeId = "default" | "sunset" | "ocean" | "neon" | "royal";

export interface AttributePalette {
  fill: string;
  bright: string;
  dark: string;
}

export interface BoardThemeDef {
  id: BoardThemeId;
  label: string;
  /** 解放に必要な累計スコア。0は常時解放(既定テーマ) */
  unlockScore: number;
  colors: Record<Attribute, AttributePalette>;
}

export const DEFAULT_BOARD_THEME_ID: BoardThemeId = "default";

/** unlockScore昇順である前提(テストで検証)。先頭は必ずdefault(常時解放)。 */
export const BOARD_THEMES: readonly BoardThemeDef[] = [
  {
    id: "default",
    label: "デフォルト",
    unlockScore: 0,
    colors: {
      fire: { fill: "#c2402f", bright: "#ff8a70", dark: "#7c2418" },
      water: { fill: "#1f6dc2", bright: "#6fc0ff", dark: "#123f7a" },
      wind: { fill: "#1f9e74", bright: "#5fe8b6", dark: "#116048" },
      light: { fill: "#c29a1f", bright: "#ffdf70", dark: "#7a5f10" },
    },
  },
  {
    id: "sunset",
    label: "夕焼け",
    unlockScore: 20_000,
    colors: {
      fire: { fill: "#e0553a", bright: "#ffb37a", dark: "#7c2a14" },
      water: { fill: "#c0507a", bright: "#ff9ec4", dark: "#6b1f3a" },
      wind: { fill: "#8a4fbe", bright: "#c9a0ff", dark: "#4a1f6e" },
      light: { fill: "#d9a12a", bright: "#ffdd8a", dark: "#7a5710" },
    },
  },
  {
    id: "ocean",
    label: "深海",
    unlockScore: 100_000,
    colors: {
      fire: { fill: "#1f5f8a", bright: "#6fdcff", dark: "#0e3550" },
      water: { fill: "#123f6e", bright: "#4fa3ff", dark: "#081f38" },
      wind: { fill: "#0e7a6b", bright: "#5fe8c9", dark: "#073d35" },
      light: { fill: "#2e5fa8", bright: "#8ec8ff", dark: "#16305a" },
    },
  },
  {
    id: "neon",
    label: "ネオン",
    unlockScore: 400_000,
    colors: {
      fire: { fill: "#c21f6b", bright: "#ff6ac2", dark: "#5c0f36" },
      water: { fill: "#0091b8", bright: "#7fe8ff", dark: "#004a63" },
      wind: { fill: "#1f9e4d", bright: "#7dffb0", dark: "#0f5c33" },
      light: { fill: "#c7a800", bright: "#fff98a", dark: "#7a6f00" },
    },
  },
  {
    id: "royal",
    label: "ロイヤル",
    unlockScore: 1_200_000,
    colors: {
      fire: { fill: "#6a2fb0", bright: "#b98cff", dark: "#2e1450" },
      water: { fill: "#1f3a8a", bright: "#7a9cff", dark: "#0e1a45" },
      wind: { fill: "#0f6e4a", bright: "#6fe8b0", dark: "#06301f" },
      light: { fill: "#c9a227", bright: "#ffe27a", dark: "#6b4f10" },
    },
  },
];

export function boardThemeById(themeId: BoardThemeId): BoardThemeDef {
  return BOARD_THEMES.find((t) => t.id === themeId) ?? BOARD_THEMES[0]!;
}

export function isBoardThemeUnlocked(themeId: BoardThemeId, totalScore: number): boolean {
  const theme = BOARD_THEMES.find((t) => t.id === themeId);
  if (!theme) return false;
  return totalScore >= theme.unlockScore;
}

/**
 * 実際に描画へ適用するテーマを決定する。
 * - High Contrast時は視認性を最優先し、常にdefault配色へフォールバックする
 *   (設計判断: カスタムテーマの配色によっては十分なコントラストを保証できないため)。
 * - 未解放のテーマが(不正な設定値・データ移行漏れなどで)指定された場合もdefaultへ
 *   フォールバックする。
 */
export function resolveBoardTheme(
  themeId: BoardThemeId,
  totalScore: number,
  highContrast: boolean,
): BoardThemeDef {
  if (highContrast) return BOARD_THEMES[0]!;
  if (!isBoardThemeUnlocked(themeId, totalScore)) return BOARD_THEMES[0]!;
  return boardThemeById(themeId);
}
