import { useEffect, useMemo, useState } from "react";
import { PHRASES } from "@type-burst/phrase-content";
import { TypingAutomaton } from "@type-burst/typing-engine";

interface Props {
  /** true なら打鍵アニメを動かさず、1件を完成形で静止表示する */
  reducedMotion: boolean;
}

/** 1文字進めるまでの間隔。実際の上級者の打鍵より少し遅く、読める速さにする */
const KEY_INTERVAL_MS = 105;
/** 打ち終えてから次の文章へ移るまでの余韻 */
const HOLD_MS = 1100;

/**
 * ホーム画面の「打った所と残り」表示(D-084)。
 *
 * このゲーム固有の画をそのままファーストビューへ置くための装飾。ローマ字は
 * ハードコードせず、実際の出題データ(PHRASES)と受理グラフ(TypingAutomaton)から
 * 算出するため、ここに出る文字列は本当にプレイ中に打つ文字列と一致する。
 * 表示専用なので aria-hidden とし、支援技術には読ませない。
 */
export function RomajiTicker({ reducedMotion }: Props): JSX.Element {
  const phrases = useMemo(() => {
    // 短めで意味が取りやすいものを先頭から数件だけ使う(乱数は使わず常に同じ並び)
    return PHRASES.filter((p) => p.tier === "short")
      .slice(0, 5)
      .map((p) => ({
        text: p.displayText,
        romaji: new TypingAutomaton(p.readingKana).getCanonicalRomaji(),
      }));
  }, []);

  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);

  const current = phrases[index % phrases.length];

  useEffect(() => {
    if (reducedMotion || !current) return;

    if (typed < current.romaji.length) {
      const id = window.setTimeout(() => setTyped((n) => n + 1), KEY_INTERVAL_MS);
      return () => window.clearTimeout(id);
    }
    // 打ち終えた: 余韻を置いてから次の文章へ
    const id = window.setTimeout(() => {
      setIndex((i) => i + 1);
      setTyped(0);
    }, HOLD_MS);
    return () => window.clearTimeout(id);
  }, [reducedMotion, current, typed]);

  if (!current) return <div className="lp-ticker" aria-hidden="true" />;

  const done = reducedMotion ? current.romaji.length : typed;

  return (
    <div className="lp-ticker" aria-hidden="true">
      <span className="lp-ticker-jp">{current.text}</span>
      <span className="lp-ticker-romaji">
        <span className="lp-ticker-done">{current.romaji.slice(0, done)}</span>
        <span className="lp-ticker-rest">{current.romaji.slice(done)}</span>
      </span>
    </div>
  );
}
