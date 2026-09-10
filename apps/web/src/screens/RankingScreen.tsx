import { useEffect, useRef, useState } from "react";
import type { SurvivalDifficulty } from "@type-burst/game-core";
import { useFitToViewport } from "../hooks/useFitToViewport";
import { fetchRanking, type RankingEntry, type RankingViewer } from "../ranking";
import { trackBehaviorEvent } from "../behaviorTelemetry";

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
  onBack: (difficulty?: SurvivalDifficulty) => void;
  initialDifficulty?: SurvivalDifficulty;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; entries: RankingEntry[]; viewer: RankingViewer | null };

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
export function RankingScreen({ onBack, initialDifficulty = "normal" }: Props): JSX.Element {
  const { ref, style } = useFitToViewport<HTMLDivElement>();
  const [difficulty, setDifficulty] = useState<SurvivalDifficulty>(initialDifficulty);
  const [view, setView] = useState<"players" | "legacy">("players");
  const [retryNonce, setRetryNonce] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const pendingLoadActionRef = useRef<
    "open" | "difficulty_easy" | "difficulty_normal" | "difficulty_hard" | "difficulty_god" | "retry"
  >("open");
  const lastRequestKeyRef = useRef<string | null>(null);
  const activeLoadActionRef = useRef<
    "open" | "difficulty_easy" | "difficulty_normal" | "difficulty_hard" | "difficulty_god" | "retry"
  >("open");
  const lastRequestAtRef = useRef(0);

  useEffect(() => {
    const refreshIfStale = (): void => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRequestAtRef.current < 15_000) return;
      pendingLoadActionRef.current = "retry";
      setRefreshNonce((value) => value + 1);
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

  useEffect(() => {
    let cancelled = false;
    const requestKey = `${difficulty}:${view}:${retryNonce}:${refreshNonce}`;
    const isNewRequest = lastRequestKeyRef.current !== requestKey;
    const action = isNewRequest ? pendingLoadActionRef.current : activeLoadActionRef.current;
    if (isNewRequest) {
      trackBehaviorEvent("ranking_action", {
        surface: "world",
        action,
        difficulty,
        status: "started",
      });
      lastRequestKeyRef.current = requestKey;
      activeLoadActionRef.current = action;
      pendingLoadActionRef.current = "open";
      lastRequestAtRef.current = Date.now();
    }
    setState({ status: "loading" });
    fetchRanking(difficulty, 100, view)
      .then((response) => {
        if (!cancelled) {
          setState({ status: "loaded", entries: response.entries, viewer: response.viewer });
          setLastUpdated(Date.now());
          trackBehaviorEvent("ranking_action", {
            surface: "world",
            action,
            difficulty,
            status: "success",
          });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: e instanceof Error ? e.message : "不明なエラー" });
          trackBehaviorEvent("ranking_action", {
            surface: "world",
            action,
            difficulty,
            status: "error",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [difficulty, view, refreshNonce, retryNonce]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onBack(difficulty);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [difficulty, onBack]);

  const entries =
    state.status === "loaded"
      ? state.entries.map((entry, index) => ({ ...entry, rank: entry.rank ?? index + 1 }))
      : [];
  const viewer = state.status === "loaded" ? state.viewer : null;
  const podiumByRank = new Map(
    entries
      .filter((entry) => (entry.rank ?? 0) <= 3)
      .map((entry) => [entry.rank, entry] as const),
  );
  const rest = entries.filter((entry) => (entry.rank ?? 0) > 3);

  return (
    <div ref={ref} style={style} className="screen ranking rk">
      <header className="rk-head">
        <div>
          <span className="rk-kicker">WORLD RANKING・全期間</span>
          <h1 className="rk-title">世界ランキング</h1>
        </div>
        <button className="rk-back" onClick={() => onBack(difficulty)} autoFocus>
          タイトルへ <span className="rk-key">Esc</span>
        </button>
      </header>

      <div className="rk-record-views" role="group" aria-label="記録の種類">
        <button type="button" aria-pressed={view === "players"} onClick={() => setView("players")}>プレイヤーベスト</button>
        <button type="button" aria-pressed={view === "legacy"} onClick={() => setView("legacy")}>以前の記録</button>
      </div>
      <p className="rk-record-explainer">
        {view === "players"
          ? "各難易度につき、1プレイヤーの最高得点だけを掲載。再挑戦でベストを更新しよう。"
          : "プレイヤー識別導入前の記録です。同じ人の複数の記録が含まれる場合があります。"}
      </p>
      <div className="rk-tabs" role="group" aria-label="難易度">
        {DIFFICULTY_ORDER.map((d, i) => (
          <button
            key={d}
            type="button"
            data-lv={i + 1}
            aria-pressed={d === difficulty}
            onClick={() => {
              if (d === difficulty) return;
              pendingLoadActionRef.current = `difficulty_${d}` as
                | "difficulty_easy"
                | "difficulty_normal"
                | "difficulty_hard"
                | "difficulty_god";
              setDifficulty(d);
            }}
          >
            <span aria-hidden="true">{DIFFICULTY_GLYPHS[d]}</span>
            {SURVIVAL_DIFFICULTY_LABELS[d]}
          </button>
        ))}
      </div>

      {state.status === "loading" && (
        <p className="rk-status" role="status" aria-live="polite">
          ランキングを読み込み中…
        </p>
      )}
      {state.status === "error" && (
        <div className="rk-status rk-status-error" role="alert" aria-live="polite">
          <p>ランキングを取得できませんでした。時間をおいて再度お試しください。</p>
          <button
            type="button"
            className="btn-secondary rk-retry"
            onClick={() => {
              pendingLoadActionRef.current = "retry";
              setRetryNonce((value) => value + 1);
            }}
          >
            もう一度読み込む
          </button>
        </div>
      )}
      {state.status === "loaded" && entries.length === 0 && (
        <p className="rk-status" role="status">まだ記録がありません。最初のランカーになろう！</p>
      )}

      <div className="rk-toolbar">
        <button
          type="button"
          className="btn-secondary rk-refresh"
          disabled={state.status === "loading"}
          onClick={() => {
            pendingLoadActionRef.current = "retry";
            setRefreshNonce((value) => value + 1);
          }}
        >
          {state.status === "loading" ? "更新中…" : "最新の順位に更新"}
        </button>
        {lastUpdated !== null && (
          <span className="rk-updated" role="status" aria-live="polite">
            最終更新 {new Intl.DateTimeFormat("ja-JP", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }).format(lastUpdated)}
          </span>
        )}
      </div>

      {viewer && (
        <p className="rk-mine">
          あなたのベストは <strong>{viewer.rank}位</strong> ／ 全
          {viewer.total.toLocaleString()}プレイヤー中
          <span className="rk-mine-detail">
            上位 {viewer.percentile.toFixed(1)}% ・ {viewer.score.toLocaleString()}点
            {viewer.scoreToNext === null
              ? " ・ 現在1位"
              : ` ・ 次の順位まであと${viewer.scoreToNext.toLocaleString()}点`}
          </span>
        </p>
      )}

      <p className="rk-scope-note" role="status">
        上位100件を表示しています。順位は他のプレイヤーの記録更新に合わせて自動更新されます。
        {view === "players" && " 別の端末でも同じ記録を使うには、設定の「データの引き継ぎ」を利用してください。同名でも別プレイヤーの場合があります。"}
      </p>

      {podiumByRank.size > 0 && (
        <>
          {/* 表彰台: 2位・1位・3位の順に並べ、1位を高くする */}
          <div className="rk-podium">
            {[2, 1, 3].map((place) => {
              const e = podiumByRank.get(place);
              if (!e) return <div key={place} className="rk-plinth rk-plinth-empty" />;
              return (
                <div
                  key={e.id}
                  className={`rk-plinth rk-plinth-${place}`}
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
                    className="rk-row"
                  >
                    <span className="rk-rank">{e.rank ?? i + 4}</span>
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
