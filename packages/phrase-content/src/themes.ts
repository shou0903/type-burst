import type { JapanesePhrase, PhraseTier } from "./types";

/**
 * 語彙テーマ(D-053)。プレイヤーがランディング画面で任意に選べる出題ジャンル。
 * 既定は "all"(おまかせ)で、従来通り全カテゴリからの出題(挙動を一切変えない)。
 */
export type VocabThemeId = "all" | "business" | "season";

export interface VocabThemeDef {
  id: VocabThemeId;
  label: string;
  /** null は「全カテゴリ対象(フィルタなし)」を意味する */
  categories: readonly string[] | null;
}

export const VOCAB_THEMES: readonly VocabThemeDef[] = [
  { id: "all", label: "おまかせ", categories: null },
  { id: "business", label: "ビジネス", categories: ["仕事"] },
  { id: "season", label: "季節・イベント", categories: ["季節"] },
];

const ALL_TIERS: readonly PhraseTier[] = ["micro", "short", "standard", "long"];

/**
 * テーマ内で「そのtierの語彙として十分」とみなす最小件数。
 * これを下回るtierは、そのテーマ専用の語彙だけでは同じ文章の反復が
 * 目立ちやすくなるため、そのtierに限りグローバルプール(全カテゴリ)へ
 * フォールバックする。これにより、どのテーマ×どの難易度の組み合わせでも
 * PlayerCore が要求するtier分布を健全なプールサイズで満たせる
 * (PlayerCoreのコンストラクタは有効フレーズ数<10で例外を投げるため、
 * 「テーマを選んだらクラッシュ/ほぼ同じ文章の繰り返しになる」事故を防ぐ)。
 */
const MIN_PHRASES_PER_TIER = 8;

/**
 * テーマに応じた出題プールを構築する。純粋関数(静的なコンテンツ配列に対する
 * フィルタのみ)なので、ゲームのシミュレーション決定性には一切影響しない。
 *
 * 設計: テーマの対象カテゴリで一致するtierごとの語彙数が
 * MIN_PHRASES_PER_TIER以上あればテーマ専用語彙のみを使い、
 * 不足するtierだけグローバル(全カテゴリ)へフォールバックする。
 * これにより「そのテーマに極端に少ないtierだけ他テーマの文章が混ざる」
 * という限定的な劣化に留め、テーマ全体がなし崩しになることはない。
 */
export function buildThemedPhrasePool(
  themeId: VocabThemeId,
  all: readonly JapanesePhrase[],
): JapanesePhrase[] {
  // VOCAB_THEMES は先頭に "all"(おまかせ)を必ず含む静的配列なので、非nullを断定できる
  const theme = VOCAB_THEMES.find((t) => t.id === themeId) ?? VOCAB_THEMES[0]!;
  if (!theme.categories) return [...all];

  const categories = theme.categories;
  const result: JapanesePhrase[] = [];
  for (const tier of ALL_TIERS) {
    const themed = all.filter((p) => p.tier === tier && categories.includes(p.category));
    if (themed.length >= MIN_PHRASES_PER_TIER) {
      result.push(...themed);
    } else {
      // フォールバック: このテーマ・このtierは語彙が手薄なため、
      // グローバルプールの同tier語彙で補い、tier分布(難易度設計)を壊さない。
      result.push(...all.filter((p) => p.tier === tier));
    }
  }
  return result;
}
