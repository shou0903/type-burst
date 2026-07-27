import { useEffect, useState } from "react";
import type { SurvivalDifficulty } from "@type-burst/game-core";
import { useFitToViewport } from "../hooks/useFitToViewport";
import { fetchTopScores, type RankingEntry } from "../ranking";
import { loadNickname } from "../storage";

const SURVIVAL_DIFFICULTY_LABELS: Record<SurvivalDifficulty, string> = {
  easy: "初級",
  normal: "中級",
  hard: "上級",
  god: "神級",
};

/** 難易度の記号と色は盤面の4属性に揃える(ホーム画面と同じ語彙、D-084) */
const DIFFICULTY_GLYPHS: Record<SurvivalDifficulty, string> = {
  easy: "◆",
  normal: "●",
  hard: "★",
  god: "▲",
};

const DIFFICULTY_ORDER: readonly SurvivalDifficulty[] = ["easy", "normal", "hard", "god"];

interface Props {
  onBack: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; entries: RankingEntry[] };

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 世界ランキング画面(D-086で全面改修)。
 * 従来は順位の表を並べるだけだったため、上位3名を表彰台として立体的に見せ、
 * 4位以降は読みやすい行リストに分けた。自分の記録は強調表示する。
 */
export function RankingScreen({ onBack }: Props): JSX.Element {
  const { ref, style } = useFitToViewport<HTMLDivElement>();
  const [difficulty, setDifficulty] = useState<SurvivalDifficulty>("normal");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const myName = loadNickname();

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchTopScores(difficulty, 100)
      .then((entries) => {
        if (!cancelled) setState({ status: "loaded", entries });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: e instanceof Error ? e.message : "不明なエラー" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [difficulty]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onBack]);

  const entries = state.status === "loaded" ? state.entries : [];
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  const myRank = myName ? entries.findIndex((e) => e.nickname === myName) : -1;

  return (
    <div ref={ref} style={style} className="screen ranking rk">
      <header className="rk-head">
        <div>
          <span className="rk-kicker">WORLD RANKING・全期間</span>
          <h1 className="rk-title">世界ランキング</h1>
        </div>
        <button className="rk-back" onClick={onBack} autoFocus>
          タイトルへ <span className="rk-key">Esc</span>
        </button>
      </header>

      <div className="rk-tabs" role="group" aria-label="難易度">
        {DIFFICULTY_ORDER.map((d, i) => (
          <button
            key={d}
            type="button"
            data-lv={i + 1}
            aria-pressed={d === difficulty}
            onClick={() => setDifficulty(d)}
          >
            <span aria-hidden="true">{DIFFICULTY_GLYPHS[d]}</span>
            {SURVIVAL_DIFFICULTY_LABELS[d]}
          </button>
        ))}
      </div>

      {state.status === "loading" && <p className="rk-status">読み込み中…</p>}
      {state.status === "error" && (
        <p className="rk-status rk-status-error">
          ランキングを取得できませんでした。時間をおいて再度お試しください。
        </p>
      )}
      {state.status === "loaded" && entries.length === 0 && (
        <p className="rk-status">まだ記録がありません。最初のランカーになろう！</p>
      )}

      {podium.length > 0 && (
        <>
          {myRank >= 0 && (
            <p className="rk-mine">
              あなた（{myName}）は <strong>{myRank + 1}位</strong> ／ 全
              {entries.length.toLocaleString()}人中
            </p>
          )}

          {/* 表彰台: 2位・1位・3位の順に並べ、1位を高くする */}
          <div className="rk-podium">
            {[1, 0, 2].map((idx) => {
              const e = podium[idx];
              if (!e) return <div key={idx} className="rk-plinth rk-plinth-empty" />;
              const place = idx + 1;
              return (
                <div
                  key={e.id}
                  className={`rk-plinth rk-plinth-${place}${
                    myName && e.nickname === myName ? " rk-is-me" : ""
                  }`}
                >
                  <div className="rk-crown">{place === 1 ? "👑" : place}</div>
                  <div className="rk-plinth-name">{e.nickname}</div>
                  <div className="rk-plinth-score">{e.score.toLocaleString()}</div>
                  <div className="rk-plinth-meta">
                    <span>{e.maxChain} 連鎖</span>
                    <span>{formatTime(e.survivedMs)}</span>
                  </div>
                  <div className="rk-base">{place}</div>
                </div>
              );
            })}
          </div>

          {rest.length > 0 && (
            <div className="rk-list">
              <div className="rk-list-head">
                <span>#</span>
                <span>ニックネーム</span>
                <span>スコア</span>
                <span>最大連鎖</span>
                <span>生存</span>
              </div>
              <div className="rk-list-body">
                {rest.map((e, i) => (
                  <div
                    key={e.id}
                    className={`rk-row${myName && e.nickname === myName ? " rk-is-me" : ""}`}
                  >
                    <span className="rk-rank">{i + 4}</span>
                    <span className="rk-name">{e.nickname}</span>
                    <span className="rk-score">{e.score.toLocaleString()}</span>
                    <span className="rk-chain">{e.maxChain}</span>
                    <span className="rk-time">{formatTime(e.survivedMs)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
