import { useEffect, useRef, useState } from "react";
import type { SurvivalDifficulty } from "@type-burst/game-core";
import type { LifetimeProgress } from "@type-burst/progression";
import { fetchTopScores, type RankingEntry } from "../ranking";
import type { StoredResult } from "../storage";

/**
 * ホーム画面の副次導線タイル(D-086)。
 *
 * 以前はアイコンと見出しだけで枠に対して中身が乏しく、間延びして見えていた。
 * 既に手元にある/取得できるデータ(世界ランキングの上位・生涯累計・直近の
 * スコア推移)を実際に載せ、押す前から価値が分かるようにする。
 */

const DIFFICULTY_LABELS: Record<SurvivalDifficulty, string> = {
  easy: "初級",
  normal: "中級",
  hard: "上級",
  god: "神級",
};

/** 上位3件を実データで見せる。押すと世界ランキング画面へ */
export function RankingDeck({
  difficulty,
  onOpen,
}: {
  difficulty: SurvivalDifficulty;
  onOpen: () => void;
}): JSX.Element {
  const [state, setState] = useState<
    { s: "loading" } | { s: "error" } | { s: "ok"; entries: RankingEntry[] }
  >({ s: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const lastRequestAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    lastRequestAtRef.current = Date.now();
    setState({ s: "loading" });
    fetchTopScores(difficulty, 3)
      .then((entries) => {
        if (!cancelled) {
          setState({ s: "ok", entries });
          setLastUpdated(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) setState({ s: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [difficulty, retryNonce]);

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
    <button
      className="lp-deck lp-deck-rich lp-deck-ranking"
      type="button"
      aria-label="世界ランキングを開く"
      onClick={onOpen}
    >
      <span className="lp-deck-top">
        <span className="lp-deck-glyph lp-glyph-light" aria-hidden="true">
          ★
        </span>
        <span className="lp-deck-title">世界ランキング</span>
        <span className="lp-deck-tag">{DIFFICULTY_LABELS[difficulty]}</span>
      </span>

      {state.s === "loading" && (
        <span className="lp-deck-empty" role="status" aria-live="polite">
          ランキングを読み込み中…
        </span>
      )}
      {state.s === "error" && (
        <span className="lp-deck-empty lp-deck-error" role="alert" aria-live="polite">
          <span>いまはランキングを取得できません</span>
          <span className="lp-deck-retry">ランキング画面で再読み込み →</span>
        </span>
      )}
      {state.s === "ok" && state.entries.length === 0 && (
        <span className="lp-deck-empty">まだ記録なし。最初のランカーへ</span>
      )}
      {state.s === "ok" && state.entries.length > 0 && (
        <span className="lp-podium">
          {state.entries.map((e, i) => (
            <span className="lp-podium-row" key={e.id}>
              <span className={`lp-medal lp-medal-${e.rank ?? i + 1}`}>{e.rank ?? i + 1}</span>
              <span className="lp-podium-name">{e.nickname}</span>
              <span className="lp-podium-score">{e.score.toLocaleString()}</span>
            </span>
          ))}
        </span>
      )}

      <span className="lp-deck-foot">
        {state.s === "error"
          ? "世界ランキングを開く →"
          : lastUpdated === null
            ? "上位100件を見る →"
            : `上位100件を見る → ・${new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(lastUpdated)}`}
      </span>
    </button>
  );
}

/** 直近スコアの推移と自己記録。押すと成長記録へ */
export function GrowthDeck({
  progress,
  results,
  difficulty,
  onOpen,
}: {
  progress: LifetimeProgress;
  results: StoredResult[];
  difficulty: SurvivalDifficulty;
  onOpen: () => void;
}): JSX.Element {
  // 同じ難易度だけを比較する。初級と神級を一本の線に混ぜると、
  // 難易度差を「上達・停滞」と誤認させてしまう。
  const comparableResults = results.filter(
    (entry) => (entry.difficulty ?? "normal") === difficulty,
  );
  // 直近12件を古い→新しい順に。1件しかない場合は線を描かない
  const points = comparableResults
    .slice(0, 12)
    .map((r) => r.score)
    .reverse();
  const comparableGames = comparableResults.length;
  // グラフは2点以上で初めて「推移」として読める。1戦だけの線を成長と
  // 誤解させず、必要な追加プレイ数も実際の残数に合わせて案内する。
  const hasComparableHistory = comparableGames >= 2;

  return (
    <button className="lp-deck lp-deck-rich" onClick={onOpen}>
      <span className="lp-deck-top">
        <span className="lp-deck-glyph lp-glyph-wind" aria-hidden="true">
          ◆
        </span>
        <span className="lp-deck-title">成長記録</span>
        <span className="lp-deck-tag">{DIFFICULTY_LABELS[difficulty]}</span>
        {progress.totalGames > 0 && <span className="lp-deck-tag">累計{progress.totalGames}戦</span>}
      </span>

      {hasComparableHistory ? (
        <>
          <span className="lp-spark-wrap">
            <Sparkline values={points} />
          </span>
          <span className="lp-microstats">
            <span>
              <b>{Math.round(progress.bestKpm)}</b>
              <i>ベストKPM</i>
            </span>
            <span>
              <b>{progress.maxChainEver}</b>
              <i>最大連鎖</i>
            </span>
          </span>
        </>
      ) : (
        <span className="lp-deck-empty">
          {progress.totalGames > 0
            ? `${DIFFICULTY_LABELS[difficulty]}の比較記録は${comparableGames}件。あと${Math.max(1, 2 - comparableGames)}回で推移が表示されます`
            : "プレイすると、KPM・正確率の伸びがここに記録されます"}
        </span>
      )}

      <span className="lp-deck-foot">推移をくわしく →</span>
    </button>
  );
}

/** 何を学べるかを先に見せる。押すとチュートリアルへ */
export function TutorialDeck({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <button className="lp-deck lp-deck-rich" onClick={onOpen}>
      <span className="lp-deck-top">
        <span className="lp-deck-glyph lp-glyph-water" aria-hidden="true">
          ●
        </span>
        <span className="lp-deck-title">チュートリアル</span>
        <span className="lp-deck-tag">7ステップ</span>
      </span>

      <span className="lp-learn">
        <span className="lp-learn-item">
          <i className="lp-glyph-fire">▲</i>打って爆破
        </span>
        <span className="lp-learn-item">
          <i className="lp-glyph-water">●</i>3個で消去
        </span>
        <span className="lp-learn-item">
          <i className="lp-glyph-wind">◆</i>落下で連鎖
        </span>
        <span className="lp-learn-item">
          <i className="lp-glyph-light">★</i>TYPE BURST
        </span>
      </span>

      <span className="lp-deck-foot">遊びながら覚える →</span>
    </button>
  );
}

const SPARK_W = 220;
const SPARK_H = 44;

/** 外部ライブラリを使わない素のSVG折れ線(既存のGrowthChartと同じ方針) */
function Sparkline({ values }: { values: number[] }): JSX.Element {
  if (values.length < 2) {
    return <span className="lp-spark-thin">記録が増えると推移が出ます</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (SPARK_W * i) / (values.length - 1);
    const y = SPARK_H - 3 - (SPARK_H - 6) * ((v - min) / span);
    return { x, y };
  });
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `0,${SPARK_H} ${line} ${SPARK_W},${SPARK_H}`;
  const last = pts[pts.length - 1]!;

  return (
    <svg
      className="lp-spark"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`直近${values.length}戦のスコア推移`}
    >
      <polygon points={area} className="lp-spark-area" />
      <polyline points={line} className="lp-spark-line" />
      <circle cx={last.x} cy={last.y} r="3" className="lp-spark-dot" />
    </svg>
  );
}
