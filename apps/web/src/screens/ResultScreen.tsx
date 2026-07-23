import { useEffect, useState } from "react";
import type { SurvivalSummary, TypingAnalysis } from "@type-burst/game-core";
import { titleProgressForScore, type LifetimeProgress } from "@type-burst/progression";
import type { GameMode, GameResult } from "../game/GameController";
import { useFitToViewport } from "../hooks/useFitToViewport";
import { loadNickname, saveNickname, type DuelRecord, type StoredResult } from "../storage";
import { submitScore } from "../ranking";
import {
  DAILY_RANKED_ATTEMPTS,
  dailyAttempts,
  dailyBestScore,
  type DailyProgress,
  type DailyRecordResult,
} from "../daily";
import {
  fetchDailyLeaderboard,
  submitDailyScore,
  type DailyLeaderboardResponse,
} from "../dailyRanking";

interface Props {
  result: GameResult;
  history: StoredResult[];
  duelRecord: DuelRecord | null;
  progress: LifetimeProgress;
  dailyProgress: DailyProgress;
  dailyRecord: DailyRecordResult | null;
  onRetry: (mode: GameMode) => void;
  onBackToTitle: () => void;
  onShowAnalysis: (analysis: TypingAnalysis, recentHistory: StoredResult[]) => void;
}

const DIFFICULTY_LABELS = { easy: "弱い", normal: "普通", hard: "強い" } as const;
const SURVIVAL_DIFFICULTY_LABELS = {
  easy: "初級",
  normal: "中級",
  hard: "上級",
  god: "神級",
} as const;

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
  progress,
  dailyProgress,
  dailyRecord,
  onRetry,
  onBackToTitle,
  onShowAnalysis,
}: Props): JSX.Element {
  const { ref, style } = useFitToViewport<HTMLDivElement>();
  const titleLabel = titleProgressForScore(progress.totalScore).current.label;
  const retryMode: GameMode =
    result.mode === "survival"
      ? { type: "survival", difficulty: result.summary.difficulty }
      : result.mode === "daily"
        ? { type: "daily", challengeId: result.challengeId, ranked: result.ranked }
        : { type: "duel", difficulty: result.summary.difficulty };

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const target = e.target;
      const isInteractive =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("button, input, select, textarea, a[href]") !== null);
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      // ボタン等のEnter/Spaceはネイティブ操作を優先する。再戦ショートカットで
      // 横取りすると「分析を見る」を押したのに再戦が始まる競合が起きる(D-060)。
      if (e.defaultPrevented || ((e.key === "Enter" || e.key === " ") && isInteractive)) return;
      // 文字入力・選択操作中のEscだけはタイトル遷移に使わない。ボタンに
      // フォーカスがある通常状態では、従来どおりEscでタイトルへ戻れる。
      if (e.key === "Escape" && isEditing) return;
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

  if (result.mode === "daily") {
    return (
      <DailyResultScreen
        result={result}
        progress={dailyProgress}
        record={dailyRecord}
        retryMode={retryMode}
        onRetry={onRetry}
        onBackToTitle={onBackToTitle}
        onShowAnalysis={onShowAnalysis}
        history={history}
      />
    );
  }

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

        <div className="result-title-badge">称号: {titleLabel}</div>

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
      <div className="result-title-badge">称号: {titleLabel}</div>
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

function DailyResultScreen({
  result,
  progress,
  record,
  retryMode,
  history,
  onRetry,
  onBackToTitle,
  onShowAnalysis,
}: {
  result: Extract<GameResult, { mode: "daily" }>;
  progress: DailyProgress;
  record: DailyRecordResult | null;
  retryMode: GameMode;
  history: StoredResult[];
  onRetry: (mode: GameMode) => void;
  onBackToTitle: () => void;
  onShowAnalysis: (analysis: TypingAnalysis, recentHistory: StoredResult[]) => void;
}): JSX.Element {
  const summary = result.summary;
  const attempts = dailyAttempts(progress, result.challengeId);
  const remaining = Math.max(0, DAILY_RANKED_ATTEMPTS - attempts);
  const best = dailyBestScore(progress, result.challengeId);
  const sameDifficultyHistory = history.filter(
    (item) => (item.difficulty ?? "normal") === summary.difficulty,
  );

  return (
    <div className="screen result daily-result">
      <h2 className="result-title">TODAY&apos;S BURST</h2>
      <p className="daily-result-date">{result.challengeId}・全員共通2分チャレンジ</p>

      <div className="result-score-wrap">
        <div className={`rank-badge rank-${rankOf(summary.score).replace("+", "plus")}`}>
          {rankOf(summary.score)}
        </div>
        <div className="result-score">{summary.score.toLocaleString()}</div>
        {summary.score >= best && summary.score > 0 && <div className="best-badge">TODAY BEST!</div>}
      </div>

      <div className="result-grid">
        <Item label="プレイ時間" value={formatTime(summary.survivedMs)} />
        <Item label="KPM" value={String(summary.kpm)} />
        <Item label="正確率" value={`${(summary.accuracy * 100).toFixed(1)}%`} />
        <Item label="文章完成" value={String(summary.phraseCount)} />
        <Item label="最大連鎖" value={String(summary.maxChain)} />
        <Item label="BURST" value={String(summary.burstCount)} />
      </div>

      <div className="daily-result-streak">
        <strong>🔥 {progress.currentStreak}日連続</strong>
        <span>
          {record?.freezeUsed
            ? "お休み券で昨日の記録を保護しました"
            : record?.freezeAwarded
              ? "7日達成！お休み券を1枚獲得しました"
              : record?.firstPlayToday
                ? "今日の連続記録を達成しました"
                : "今日の記録は達成済みです"}
        </span>
      </div>

      <DailyRankingBox
        challengeId={result.challengeId}
        summary={summary}
        ranked={result.ranked}
      />

      <p className="daily-attempt-note">
        {remaining > 0
          ? `今日の記録挑戦は残り${remaining}回です`
          : "今日の記録挑戦3回は終了。以降はランキング対象外の練習です"}
      </p>
      <button className="btn-daily" onClick={() => onRetry(retryMode)} autoFocus>
        {remaining > 0 ? "今日のベストを更新する" : "同じステージを練習する"}
      </button>
      <button
        className="btn-secondary"
        onClick={() => onShowAnalysis(summary.analysis, sameDifficultyHistory)}
      >
        タイピング分析を見る
      </button>
      <button className="btn-secondary" onClick={onBackToTitle}>タイトルへ</button>
    </div>
  );
}

function DailyRankingBox({
  challengeId,
  summary,
  ranked,
}: {
  challengeId: string;
  summary: SurvivalSummary;
  ranked: boolean;
}): JSX.Element {
  const [savedNickname, setSavedNickname] = useState(loadNickname());
  const [nickname, setNickname] = useState(savedNickname ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [ranking, setRanking] = useState<DailyLeaderboardResponse | null>(null);

  useEffect(() => {
    let active = true;
    if (ranked && savedNickname && summary.score > 0) {
      setStatus("loading");
      submitDailyScore(savedNickname, challengeId, summary)
        .then((response) => {
          if (!active) return;
          setRanking(response);
          setStatus("done");
        })
        .catch(() => active && setStatus("error"));
    } else {
      fetchDailyLeaderboard(challengeId)
        .then((response) => {
          if (!active) return;
          setRanking(response);
          setStatus("done");
        })
        .catch(() => active && setStatus("error"));
    }
    return () => {
      active = false;
    };
  }, [challengeId, ranked, savedNickname, summary]);

  const submit = (): void => {
    const trimmed = nickname.trim();
    if (!trimmed) return;
    saveNickname(trimmed);
    setSavedNickname(trimmed);
  };

  return (
    <section className="daily-ranking-box">
      <div className="daily-ranking-title">本日のランキング</div>
      {ranked && !savedNickname && (
        <>
          <p>ニックネームを登録すると、今回の記録が本日のランキングに反映されます。</p>
          <div className="ranking-submit-row">
            <input
              className="nickname-input"
              maxLength={12}
              value={nickname}
              placeholder="ニックネーム"
              onChange={(event) => setNickname(event.target.value)}
            />
            <button
              className="btn-ranking-submit"
              disabled={!nickname.trim()}
              onClick={submit}
            >
              登録
            </button>
          </div>
        </>
      )}
      {status === "loading" && <p className="ranking-status">ランキングへ反映中…</p>}
      {status === "error" && (
        <p className="ranking-status ranking-error">
          ランキングを取得できませんでした。記録は端末に保存されています。
        </p>
      )}
      {ranking?.viewer && (
        <div className="daily-viewer-rank">
          <strong>{ranking.viewer.rank}位</strong>
          <span>
            ／{ranking.viewer.total.toLocaleString()}人・上位{ranking.viewer.percentile.toFixed(1)}%
          </span>
          {ranking.viewer.scoreToNext !== null && (
            <small>ひとつ上まであと{ranking.viewer.scoreToNext.toLocaleString()}点</small>
          )}
        </div>
      )}
      {ranking && ranking.entries.length > 0 && (
        <ol className="daily-ranking-mini">
          {ranking.entries.slice(0, 5).map((entry) => (
            <li key={`${entry.rank}-${entry.nickname}`}>
              <span>{entry.rank}位 {entry.nickname}</span>
              <strong>{entry.score.toLocaleString()}</strong>
            </li>
          ))}
        </ol>
      )}
      {!ranked && <p className="ranking-status">今回の練習スコアはランキング対象外です。</p>}
    </section>
  );
}

type SubmitStatus = "idle" | "submitting" | "done" | "error";

const RANKING_SUBMITTED_KEY_PREFIX = "typeblast.ranking-submitted.v1";

function rankingSubmissionKey(summary: SurvivalSummary): string {
  return `${RANKING_SUBMITTED_KEY_PREFIX}:${summary.seed}`;
}

function wasRankingSubmitted(summary: SurvivalSummary): boolean {
  try {
    return sessionStorage.getItem(rankingSubmissionKey(summary)) === "1";
  } catch {
    return false;
  }
}

function markRankingSubmitted(summary: SurvivalSummary): void {
  try {
    sessionStorage.setItem(rankingSubmissionKey(summary), "1");
  } catch {
    // sessionStorage不可でも、ランキング送信そのものは成功として扱う
  }
}

/** サバイバル結果を世界ランキングへ送信する。未入力ならスキップ可能(登録は任意) */
function RankingSubmitBox({ summary }: { summary: SurvivalSummary }): JSX.Element | null {
  const [savedNickname, setSavedNickname] = useState(loadNickname());
  const [nickname, setNickname] = useState(savedNickname ?? "");
  const [status, setStatus] = useState<SubmitStatus>(() =>
    wasRankingSubmitted(summary) ? "done" : "idle",
  );
  const [skipped, setSkipped] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // APIは0点を妥当なランキング記録として受け付けない。送信欄も自動送信も出さない。
    if (summary.score <= 0 || wasRankingSubmitted(summary)) return;
    if (savedNickname) {
      setStatus("submitting");
      submitScore(savedNickname, summary)
        .then((result) => {
          if (result.ok) markRankingSubmitted(summary);
          setStatus(result.ok ? "done" : "error");
        })
        .catch(() => setStatus("error"));
    }
    // 初回マウント時のみ送信する(summaryは1回分の結果のため依存配列は空でよい)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (summary.score <= 0) {
    return <p className="ranking-submit-unavailable">スコアを獲得するとランキングに登録できます。</p>;
  }
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
      .then((result) => {
        if (result.ok) markRankingSubmitted(summary);
        setStatus(result.ok ? "done" : "error");
      })
      .catch(() => setStatus("error"));
  };

  return (
    <div className="ranking-submit-box">
      <div className="ranking-submit-label">ニックネームで世界ランキングに登録（任意）</div>
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
