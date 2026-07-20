import { useEffect } from "react";
import type { GameMode, GameResult } from "../game/GameController";
import { useFitToViewport } from "../hooks/useFitToViewport";
import type { DuelRecord, StoredResult } from "../storage";

interface Props {
  result: GameResult;
  history: StoredResult[];
  duelRecord: DuelRecord | null;
  onRetry: (mode: GameMode) => void;
  onBackToTitle: () => void;
}

const DIFFICULTY_LABELS = { easy: "よわい", normal: "ふつう", hard: "つよい" } as const;

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ResultScreen({ result, history, duelRecord, onRetry, onBackToTitle }: Props): JSX.Element {
  const { ref, style } = useFitToViewport<HTMLDivElement>();
  const retryMode: GameMode =
    result.mode === "survival"
      ? { type: "survival" }
      : { type: "duel", difficulty: result.summary.difficulty };

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onRetry(retryMode);
      } else if (e.key === "Escape") {
        onBackToTitle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRetry, onBackToTitle]);

  if (result.mode === "survival") {
    const summary = result.summary;
    const previous = history[1];
    const best = history.reduce((max, r) => Math.max(max, r.score), 0);
    const isBest = summary.score >= best && summary.score > 0;
    const delta = previous ? summary.score - previous.score : null;
    const hint = buildHint(summary.accuracy, summary.maxChain, summary.kpm, summary.phraseCount);

    const rank = rankOf(summary.score);

    return (
      <div ref={ref} style={style} className="screen result">
        <h2 className="result-title">SURVIVAL RESULT</h2>

        <div className="result-score-wrap">
          <div className={`rank-badge rank-${rank.replace("+", "plus")}`}>{rank}</div>
          <div className="result-score">{summary.score.toLocaleString()}</div>
          {isBest && <div className="best-badge">BEST!</div>}
          {delta !== null && (
            <div className={delta >= 0 ? "delta delta-up" : "delta delta-down"}>
              前回比 {delta >= 0 ? "+" : ""}
              {delta.toLocaleString()}
            </div>
          )}
        </div>

        <div className="result-grid">
          <Item label="生存時間" value={formatTime(summary.survivedMs)} />
          <Item label="LEVEL" value={String(summary.level)} />
          <Item label="最大連鎖" value={String(summary.maxChain)} />
          <Item label="KPM" value={String(summary.kpm)} />
          <Item label="正確率" value={`${(summary.accuracy * 100).toFixed(1)}%`} />
          <Item label="文章完成" value={String(summary.phraseCount)} />
          <Item label="BURST" value={String(summary.burstCount)} />
        </div>

        {hint && <p className="result-hint">{hint}</p>}

        <button className="btn-primary" onClick={() => onRetry(retryMode)} autoFocus>
          もう一戦 <span className="btn-sub">Enter</span>
        </button>
        <button className="btn-secondary" onClick={onBackToTitle}>
          タイトルへ
        </button>
      </div>
    );
  }

  const summary = result.summary;
  const record = duelRecord?.[summary.difficulty];

  return (
    <div ref={ref} style={style} className="screen result">
      <h2 className={summary.won ? "result-title win-title" : "result-title lose-title"}>
        {summary.won ? "YOU WIN!" : "YOU LOSE…"}
      </h2>
      <p className="duel-sub">
        CPU({DIFFICULTY_LABELS[summary.difficulty]})/ {formatTime(summary.durationMs)}
        {record && (
          <>
            {" "}
            ・通算 {record.wins}勝{record.losses}敗
          </>
        )}
      </p>

      <div className="duel-table">
        <div className="duel-col">
          <div className="duel-col-title">あなた</div>
          <Item label="スコア" value={summary.player.score.toLocaleString()} />
          <Item label="最大連鎖" value={String(summary.player.maxChain)} />
          <Item label="妨害送信" value={String(summary.player.garbageSent)} />
          <Item label="KPM" value={String(summary.player.kpm)} />
          <Item label="正確率" value={`${(summary.player.accuracy * 100).toFixed(1)}%`} />
        </div>
        <div className="duel-col duel-col-cpu">
          <div className="duel-col-title">CPU</div>
          <Item label="スコア" value={summary.cpu.score.toLocaleString()} />
          <Item label="最大連鎖" value={String(summary.cpu.maxChain)} />
          <Item label="妨害送信" value={String(summary.cpu.garbageSent)} />
          <Item label="KPM" value={String(summary.cpu.kpm)} />
          <Item label="正確率" value={`${(summary.cpu.accuracy * 100).toFixed(1)}%`} />
        </div>
      </div>

      <button className="btn-primary" onClick={() => onRetry(retryMode)} autoFocus>
        再戦 <span className="btn-sub">Enter</span>
      </button>
      <button className="btn-secondary" onClick={onBackToTitle}>
        タイトルへ
      </button>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="result-item">
      <div className="result-label">{label}</div>
      <div className="result-value">{value}</div>
    </div>
  );
}

function rankOf(score: number): string {
  if (score >= 50000) return "S+";
  if (score >= 32000) return "S";
  if (score >= 20000) return "A";
  if (score >= 12000) return "B";
  if (score >= 6000) return "C";
  return "D";
}

function buildHint(
  accuracy: number,
  maxChain: number,
  kpm: number,
  phraseCount: number,
): string | null {
  if (accuracy < 0.85) {
    return "ミスが多め。速さより「最後まで正確に打ち切る」ことを意識すると連鎖が安定します。";
  }
  if (maxChain <= 1 && phraseCount >= 3) {
    return "同じ色が縦横につながる場所を狙って消すと、落下連鎖でスコアが大きく伸びます。";
  }
  if (kpm < 150) {
    return "ホームポジションを意識して、次の文字を先読みしながら打ってみましょう。";
  }
  return null;
}
