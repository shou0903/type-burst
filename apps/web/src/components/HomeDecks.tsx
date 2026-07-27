import { useEffect, useState } from "react";
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

  useEffect(() => {
    let cancelled = false;
    setState({ s: "loading" });
    fetchTopScores(difficulty, 3)
      .then((entries) => {
        if (!cancelled) setState({ s: "ok", entries });
      })
      .catch(() => {
        if (!cancelled) setState({ s: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [difficulty]);

  return (
    <button className="lp-deck lp-deck-rich" onClick={onOpen}>
      <span className="lp-deck-top">
        <span className="lp-deck-glyph lp-glyph-light" aria-hidden="true">
          ★
        </span>
        <span className="lp-deck-title">世界ランキング</span>
        <span className="lp-deck-tag">{DIFFICULTY_LABELS[difficulty]}</span>
      </span>

      {state.s === "loading" && <span className="lp-deck-empty">読み込み中…</span>}
      {state.s === "error" && <span className="lp-deck-empty">いまは取得できません</span>}
      {state.s === "ok" && state.entries.length === 0 && (
        <span className="lp-deck-empty">まだ記録なし。最初のランカーへ</span>
      )}
      {state.s === "ok" && state.entries.length > 0 && (
        <span className="lp-podium">
          {state.entries.map((e, i) => (
            <span className="lp-podium-row" key={e.id}>
              <span className={`lp-medal lp-medal-${i + 1}`}>{i + 1}</span>
              <span className="lp-podium-name">{e.nickname}</span>
              <span className="lp-podium-score">{e.score.toLocaleString()}</span>
            </span>
          ))}
        </span>
      )}

      <span className="lp-deck-foot">全順位を見る →</span>
    </button>
  );
}

/** 直近スコアの推移と自己記録。押すと成長記録へ */
export function GrowthDeck({
  progress,
  results,
  onOpen,
}: {
  progress: LifetimeProgress;
  results: StoredResult[];
  onOpen: () => void;
}): JSX.Element {
  // 直近12件を古い→新しい順に。1件しかない場合は線を描かない
  const points = results
    .slice(0, 12)
    .map((r) => r.score)
    .reverse();
  const hasPlayed = progress.totalGames > 0;

  return (
    <button className="lp-deck lp-deck-rich" onClick={onOpen}>
      <span className="lp-deck-top">
        <span className="lp-deck-glyph lp-glyph-wind" aria-hidden="true">
          ◆
        </span>
        <span className="lp-deck-title">成長記録</span>
        {hasPlayed && <span className="lp-deck-tag">{progress.totalGames}戦</span>}
      </span>

      {hasPlayed ? (
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
          プレイすると、KPM・正確率の伸びがここに記録されます
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
