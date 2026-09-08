import { useEffect, useRef, useState } from "react";
import { fetchTopScores, type RankingEntry } from "../ranking";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; entries: RankingEntry[] };

const PREVIEW_LIMIT = 10;

interface Props {
  expanded: boolean;
}

/**
 * モバイル・ランディングページ(D-057)向けの軽量版世界ランキング。
 * PC版の RankingScreen.tsx(難易度切替・useFitToViewport等のフル機能)は
 * 全画面前提の作りで流用しづらいため、あくまで「表だけ見せる」おまけとして
 * 中級固定・上位10件のみを表示する簡易版を別途用意した。
 */
export function MobileRankingPreview({ expanded }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);
  const lastRequestAtRef = useRef(0);
  const visibleLimit = expanded ? PREVIEW_LIMIT : 3;

  useEffect(() => {
    let cancelled = false;
    lastRequestAtRef.current = Date.now();
    fetchTopScores("normal", PREVIEW_LIMIT)
      .then((entries) => {
        if (!cancelled) setState({ status: "loaded", entries });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  useEffect(() => {
    const refreshIfStale = (): void => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRequestAtRef.current < 15_000) return;
      setRetryNonce((value) => value + 1);
    };
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    const timer = window.setInterval(refreshIfStale, 30_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, []);

  return (
    <section className="mobile-landing-ranking" aria-label="世界ランキングプレビュー">
      <div className="mobile-landing-ranking-head">
        <p className="mobile-landing-ranking-caption">🏆 みんなのベスト</p>
        <span>世界ランキング・中級 TOP{visibleLimit}</span>
      </div>
      {state.status === "loading" && (
        <p className="mobile-landing-ranking-status" role="status" aria-live="polite">
          読み込み中…
        </p>
      )}
      {state.status === "error" && (
        <div className="mobile-landing-ranking-status" role="alert" aria-live="polite">
          <p>取得できませんでした。</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setRetryNonce((value) => value + 1);
            }}
          >
            再読み込み
          </button>
        </div>
      )}
      {state.status === "loaded" && state.entries.length === 0 && (
        <p className="mobile-landing-ranking-status">まだ記録がありません。</p>
      )}
      {state.status === "loaded" && state.entries.length > 0 && (
        <ol className="mobile-landing-ranking-list">
          {state.entries.slice(0, visibleLimit).map((entry, i) => (
            <li key={entry.id}>
              <span className="mobile-landing-ranking-rank">{i + 1}</span>
              <span className="mobile-landing-ranking-name">{entry.nickname}</span>
              <span className="mobile-landing-ranking-score">{entry.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
