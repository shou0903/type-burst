import { useEffect, useState } from "react";
import type { SurvivalSummary, TypingAnalysis } from "@type-burst/game-core";
import type { GameMode, GameResult } from "../game/GameController";
import { useFitToViewport } from "../hooks/useFitToViewport";
import { loadNickname, saveNickname, type DuelRecord, type StoredResult } from "../storage";
import { submitScore } from "../ranking";

interface Props {
  result: GameResult;
  history: StoredResult[];
  duelRecord: DuelRecord | null;
  onRetry: (mode: GameMode) => void;
  onBackToTitle: () => void;
  onShowAnalysis: (analysis: TypingAnalysis, recentHistory: StoredResult[]) => void;
}

const DIFFICULTY_LABELS = { easy: "弱い", normal: "普通", hard: "強い" } as const;
const SURVIVAL_DIFFICULTY_LABELS = { easy: "初級", normal: "中級", hard: "上級" } as const;

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ResultScreen({
  result,
  history,
  duelRecord,
  onRetry,
  onBackToTitle,
  onShowAnalysis,
}: Props): JSX.Element {
  const { ref, style } = useFitToViewport<HTMLDivElement>();
  const retryMode: GameMode =
    result.mode === "survival"
      ? { type: "survival", difficulty: result.summary.difficulty }
      : { type: "duel", difficulty: result.summary.difficulty };

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // ニックネーム入力中はEnter/Escをショートカットとして奪わない
      if (e.target instanceof HTMLInputElement) return;
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
    const sameDifficultyHistory = history.filter(
      (r) => (r.difficulty ?? "normal") === summary.difficulty,
    );
    const previous = sameDifficultyHistory[1];
    const best = sameDifficultyHistory.reduce((max, r) => Math.max(max, r.score), 0);
    const isBest = summary.score >= best && summary.score > 0;
    const delta = previous ? summary.score - previous.score : null;
    const hint = buildHint(summary.accuracy, summary.maxChain, summary.kpm, summary.phraseCount);

    const rank = rankOf(summary.score);

    return (
      <div ref={ref} style={style} className="screen result">
        <h2 className="result-title">
          SURVIVAL RESULT{" "}
          <span className="duel-sub result-difficulty">
            {SURVIVAL_DIFFICULTY_LABELS[summary.difficulty]}
          </span>
        </h2>

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

        <RankingSubmitBox summary={summary} />

        <button className="btn-primary" onClick={() => onRetry(retryMode)} autoFocus>
          もう一戦 <span className="btn-sub">Enter</span>
        </button>
        <button
          className="btn-secondary"
          onClick={() => onShowAnalysis(summary.analysis, sameDifficultyHistory)}
        >
          タイピング分析を見る
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
      <button className="btn-secondary" onClick={() => onShowAnalysis(summary.player.analysis, [])}>
        タイピング分析を見る
      </button>
      <button className="btn-secondary" onClick={onBackToTitle}>
        タイトルへ
      </button>
    </div>
  );
}

type SubmitStatus = "idle" | "submitting" | "done" | "error";

/** サバイバル結果を世界ランキングへ送信する。未入力ならスキップ可能(登録は任意) */
function RankingSubmitBox({ summary }: { summary: SurvivalSummary }): JSX.Element | null {
  const [savedNickname, setSavedNickname] = useState(loadNickname());
  const [nickname, setNickname] = useState(savedNickname ?? "");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [skipped, setSkipped] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (savedNickname) {
      setStatus("submitting");
      submitScore(savedNickname, summary)
        .then((result) => setStatus(result.ok ? "done" : "error"))
        .catch(() => setStatus("error"));
    }
    // 初回マウント時のみ送信する(summaryは1回分の結果のため依存配列は空でよい)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (skipped) return null;

  const handleRename = (): void => {
    const trimmed = nickname.trim();
    if (!trimmed) return;
    saveNickname(trimmed);
    setSavedNickname(trimmed);
    setEditing(false);
  };

  if (savedNickname) {
    if (editing) {
      return (
        <div className="ranking-submit-box">
          <div className="ranking-submit-label">ニックネームを変更(次回以降の登録に反映されます)</div>
          <div className="ranking-submit-row">
            <input
              className="nickname-input"
              type="text"
              placeholder="ニックネーム"
              maxLength={12}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoFocus
            />
            <button
              className="btn-ranking-submit"
              onClick={handleRename}
              disabled={nickname.trim().length === 0}
            >
              変更
            </button>
          </div>
          <button
            className="btn-ranking-skip"
            onClick={() => {
              setNickname(savedNickname);
              setEditing(false);
            }}
          >
            キャンセル
          </button>
        </div>
      );
    }
    return (
      <div className="ranking-submit-box">
        {status === "submitting" && (
          <span className="ranking-submit-status">ランキングに送信中…</span>
        )}
        {status === "done" && (
          <span className="ranking-submit-status">🏆 ランキングに登録しました({savedNickname})</span>
        )}
        {status === "error" && (
          <span className="ranking-submit-status error">
            ランキングへの送信に失敗しました(スコアは手元に保存済みです)
          </span>
        )}
        <button className="btn-nickname-edit" onClick={() => setEditing(true)}>
          ニックネームを変更
        </button>
      </div>
    );
  }

  const handleSubmit = (): void => {
    const trimmed = nickname.trim();
    if (!trimmed) return;
    setStatus("submitting");
    saveNickname(trimmed);
    setSavedNickname(trimmed);
    submitScore(trimmed, summary)
      .then((result) => setStatus(result.ok ? "done" : "error"))
      .catch(() => setStatus("error"));
  };

  return (
    <div className="ranking-submit-box">
      <div className="ranking-submit-label">ランキングに登録する(任意・登録不要の方針は維持)</div>
      <div className="ranking-submit-row">
        <input
          className="nickname-input"
          type="text"
          placeholder="ニックネーム"
          maxLength={12}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          disabled={status === "submitting"}
        />
        <button
          className="btn-ranking-submit"
          onClick={handleSubmit}
          disabled={status === "submitting" || nickname.trim().length === 0}
        >
          登録
        </button>
      </div>
      {status === "error" && (
        <span className="ranking-submit-status error">送信に失敗しました。もう一度お試しください</span>
      )}
      <button className="btn-ranking-skip" onClick={() => setSkipped(true)}>
        今回はスキップ
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
