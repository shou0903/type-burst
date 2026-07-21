/**
 * 季節テーマの「今月のおすすめ」演出(D-053, Feature 2)。
 * 現在の月から季節ラベルを返すだけの純粋関数。日付に応じて表示が変わる軽い
 * 演出であり、コンテンツ自体をロックする(選べなくする)ことは一切しない。
 * ゲームロジック(game-core)には触れないため、シミュレーションの決定性には影響しない。
 */
export interface SeasonalBadge {
  emoji: string;
  seasonLabel: string;
}

export function getSeasonalBadge(date: Date = new Date()): SeasonalBadge {
  const month = date.getMonth() + 1; // 1-12
  if (month === 12 || month === 1 || month === 2) return { emoji: "❄️", seasonLabel: "冬" };
  if (month >= 3 && month <= 5) return { emoji: "🌸", seasonLabel: "春" };
  if (month >= 6 && month <= 8) return { emoji: "🎆", seasonLabel: "夏" };
  return { emoji: "🍁", seasonLabel: "秋" };
}
