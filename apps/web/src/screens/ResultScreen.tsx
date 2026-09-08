import { useEffect, useRef, useState } from "react";
import type { SurvivalSummary, TypingAnalysis } from "@type-burst/game-core";
import { titleProgressForScore, type LifetimeProgress } from "@type-burst/progression";
import type { GameMode, GameResult } from "../game/GameController";
import { useFitToViewport } from "../hooks/useFitToViewport";
import {
  getStoredResultRuleset,
  loadNickname,
  saveNickname,
  SURVIVAL_RULESET,
  type DuelRecord,
  type StoredResult,
} from "../storage";
import { submitScore } from "../ranking";
import {
  enqueueRankingSubmission,
  removePendingRankingSubmission,
} from "../rankingOutbox";
import {
  DAILY_RANKED_ATTEMPTS,
  dailyAttempts,
  dailyBestScore,
  dailyChallengeId,
  type DailyProgress,
  type DailyRecordResult,
} from "../daily";
import {
  fetchDailyLeaderboard,
  submitDailyScore,
  type DailyLeaderboardResponse,
} from "../dailyRanking";
import { ShareSheet } from "../components/ShareSheet";
import {
  buildDailyShare,
  buildDuelShare,
  buildSurvivalShare,
  type ShareContent,
} from "../share/shareContent";
import { trackFunnelEvent } from "../seoAttribution";
import { trackBehaviorEvent } from "../behaviorTelemetry";
import {
  buildNextMatchGoal,
  type NextMatchGoal,
} from "../nextMatchGoal";
import {
  focusGoalDefinition,
  focusProgressFromResult,
  focusProgressText,
  type FocusProgress,
} from "../focusContract";

interface Props {
  result: GameResult;
  history: StoredResult[];
  duelRecord: DuelRecord | null;
  progress: LifetimeProgress;
  dailyProgress: DailyProgress;
  dailyRecord: DailyRecordResult | null;
  reducedMotion: boolean;
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
  reducedMotion,
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
        ? {
            type: "daily",
            // 結果画面を日付境界をまたいで開いたままでも、再戦は常に
            // 開始時点の今日のチャレンジへ進める。古いchallengeIdを
            // 引き継ぐと、開始時刻と日付が一致せず送信時に拒否される。
            challengeId: dailyChallengeId(),
            ranked: result.ranked,
          }
        : { type: "duel", difficulty: result.summary.difficulty };
  const motionReduced =
    reducedMotion ||
    (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const displayScore = useCountUp(
    result.mode === "survival" ? result.summary.score : 0,
    motionReduced,
  );

  const trackResultAction = (action: "retry" | "analysis" | "title"): void => {
    trackBehaviorEvent("result_action", { mode: result.mode, action });
  };
  const handleRetry = (mode: GameMode): void => {
    trackResultAction("retry");
    onRetry(mode);
  };
  const handleShowAnalysis = (analysis: TypingAnalysis, recentHistory: StoredResult[]): void => {
    trackResultAction("analysis");
    onShowAnalysis(analysis, recentHistory);
  };
  const handleBackToTitle = (): void => {
    trackResultAction("title");
    onBackToTitle();
  };

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
        handleRetry(retryMode);
      } else if (e.key === "Escape") {
        handleBackToTitle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryMode]);

  if (result.mode === "daily") {
    return (
      <DailyResultScreen
        result={result}
        progress={dailyProgress}
        record={dailyRecord}
        retryMode={retryMode}
        onRetry={handleRetry}
        onBackToTitle={handleBackToTitle}
        onShowAnalysis={handleShowAnalysis}
        history={history}
      />
    );
  }

  if (result.mode === "survival") {
    const summary = result.summary;
    const sameDifficultyHistory = history.filter(
      (r) =>
        r.mode !== "daily" &&
        getStoredResultRuleset(r) === SURVIVAL_RULESET &&
        (r.difficulty ?? "normal") === summary.difficulty,
    );
    const previous = sameDifficultyHistory[1];
    const previousBest = sameDifficultyHistory
      .slice(1)
      .reduce((max, r) => Math.max(max, r.score), 0);
    const isBest = summary.score > previousBest && summary.score > 0;
    const delta = previous ? summary.score - previous.score : null;
    const nextMatchGoal = buildNextMatchGoal(summary, sameDifficultyHistory.slice(1));
    const highlight = survivalRunHighlight(summary);
    // GameScreenが通常サバイバルの終了時だけ付ける任意のFOCUS結果。
    // 古い結果や daily/duel には値がないため、従来レイアウトをそのまま保つ。
    const focusProgress = focusProgressFromResult(result);

    const rank = rankOf(summary.score);

    return (
      <div
        ref={ref}
        style={style}
        className={`screen result survival-result${isBest ? " survival-result-best" : ""}${
          motionReduced ? " result-motion-reduced" : ""
        }`}
      >
        {isBest && (
          <div className="result-celebration" aria-hidden="true">
            <div className="result-best-flash" />
            <div className="result-confetti">
              {Array.from({ length: 14 }, (_, index) => <i key={index} />)}
            </div>
          </div>
        )}

        <header className="result-brand">
          <div className="result-brand-name">
            TYPE <span>BURST</span>
          </div>
          <div className="result-brand-caption">SURVIVAL RESULT</div>
        </header>

        <div className="result-mode-line" aria-label="プレイ条件">
          <span className="result-mode-chip">SURVIVAL</span>
          <span className="result-difficulty-chip">
            {SURVIVAL_DIFFICULTY_LABELS[summary.difficulty]}
          </span>
        </div>

        <section className="result-score-stage" aria-label="今回の結果">
          <div
            className={`rank-badge result-rank-badge rank-${rank.replace("+", "plus")}`}
            aria-label={`ランク ${rank}`}
          >
            <span className="result-rank-label">RANK</span>
            <strong>{rank}</strong>
          </div>
          <div className="result-score-panel">
            <div className="result-score-label">FINAL SCORE</div>
            <div
              className="result-score"
              aria-label={`スコア ${summary.score.toLocaleString()}`}
              aria-live="off"
            >
              {displayScore.toLocaleString()}
            </div>
            <div className="result-score-meta">
              {isBest && (
                <div className="best-badge">
                  <span>NEW</span> PERSONAL BEST
                </div>
              )}
              {delta !== null && (
                <div className={delta >= 0 ? "delta delta-up" : "delta delta-down"}>
                  前回比 {delta >= 0 ? "+" : ""}
                  {delta.toLocaleString()}
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="result-title-badge">
          <span>獲得称号</span>
          <strong>{titleLabel}</strong>
        </div>

        <div className="result-grid result-primary-stats">
          <Item label="KPM" value={String(summary.kpm)} />
          <Item label="正確率" value={`${(summary.accuracy * 100).toFixed(1)}%`} />
          <Item label="最大連鎖" value={String(summary.maxChain)} />
          <Item label="生存時間" value={formatTime(summary.survivedMs)} />
        </div>

        <div className="result-secondary-stats" aria-label="詳細記録">
          <span>LEVEL <strong>{summary.level}</strong></span>
          <span>文章完成 <strong>{summary.phraseCount}</strong></span>
          <span>BURST <strong>{summary.burstCount}</strong></span>
        </div>

        <section className={`run-highlight run-highlight-${highlight.tone}`} aria-label="今回のハイライト">
          <div className="run-highlight-kicker">RUN HIGHLIGHT</div>
          <strong>{highlight.title}</strong>
          <span>{highlight.detail}</span>
        </section>

        {focusProgress && <FocusResultCard progress={focusProgress} />}

        <NextMatchGoalCard summary={nextMatchGoal} />

        <RankingSubmitBox summary={summary} />

        <div className="result-actions">
          <button className="btn-primary" onClick={() => handleRetry(retryMode)} autoFocus>
            もう一戦 <span className="btn-sub">Enter</span>
          </button>
          <ShareAction
            score={summary.score}
            mode="survival"
            build={() => buildSurvivalShare(summary, rank, loadNickname())}
          />
          <button
            className="btn-secondary btn-analysis"
            onClick={() => handleShowAnalysis(summary.analysis, sameDifficultyHistory)}
          >
            タイピング分析を見る
          </button>
          <button className="btn-secondary" onClick={handleBackToTitle}>
            タイトルへ
          </button>
        </div>
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

      <button className="btn-primary" onClick={() => handleRetry(retryMode)} autoFocus>
        再戦 <span className="btn-sub">Enter</span>
      </button>
      <ShareAction
        score={summary.player.score}
        mode="duel"
        build={() => buildDuelShare(summary, loadNickname())}
      />
      <button className="btn-secondary" onClick={() => handleShowAnalysis(summary.player.analysis, [])}>
        タイピング分析を見る
      </button>
      <button className="btn-secondary" onClick={handleBackToTitle}>
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
  const currentChallengeId = dailyChallengeId();
  const challengeRolledOver = currentChallengeId !== result.challengeId;
  const retryAttempts = challengeRolledOver
    ? dailyAttempts(progress, currentChallengeId)
    : attempts;
  const retryRemaining = Math.max(0, DAILY_RANKED_ATTEMPTS - retryAttempts);
  const best = dailyBestScore(progress, result.challengeId);
  const sameDifficultyHistory = history.filter(
    (item) => item.mode === "daily" && (item.difficulty ?? "normal") === summary.difficulty,
  );
  // 共有カードに順位を載せたいので、ランキング欄が取得した自分の順位を受け取る(D-091)
  const [viewer, setViewer] = useState<DailyLeaderboardResponse["viewer"]>(null);

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
            ? "連続記録キープが自動で使われ、昨日の空白を保護しました"
            : record?.freezeAwarded
              ? "7日達成！1日休んでも連続記録を保てる権利を獲得しました"
              : record?.firstPlayToday
                ? "今日の連続記録を達成しました"
                : "今日の記録は達成済みです"}
        </span>
      </div>

      <DailyRankingBox
        challengeId={result.challengeId}
        summary={summary}
        ranked={result.ranked}
        submissionId={result.submissionId}
        startedAt={result.startedAt}
        attemptToken={result.attemptToken}
        onViewer={setViewer}
      />

      <p className="daily-attempt-note">
        {challengeRolledOver
          ? `日付が変わりました。${currentChallengeId}のチャレンジとして再挑戦できます（残り${retryRemaining}回）`
          : remaining > 0
          ? `今日の記録挑戦は残り${remaining}回です`
          : "今日の記録挑戦3回は終了。以降はランキング対象外の練習です"}
      </p>
      <button className="btn-daily" onClick={() => onRetry(retryMode)} autoFocus>
        {challengeRolledOver || retryRemaining > 0 ? "今日のチャレンジに挑戦する" : "同じステージを練習する"}
      </button>
      <ShareAction
        score={summary.score}
        mode="daily"
        build={() =>
          buildDailyShare({
            summary,
            challengeId: result.challengeId,
            nickname: loadNickname(),
            streak: progress.currentStreak,
            viewer,
          })
        }
      />
      <button
        className="btn-secondary btn-analysis"
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
  submissionId,
  startedAt,
  attemptToken,
  onViewer,
}: {
  challengeId: string;
  summary: SurvivalSummary;
  ranked: boolean;
  submissionId?: string;
  startedAt?: number;
  attemptToken?: string;
  onViewer: (viewer: DailyLeaderboardResponse["viewer"]) => void;
}): JSX.Element {
  const [savedNickname, setSavedNickname] = useState(loadNickname());
  const [nickname, setNickname] = useState(savedNickname ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ranking, setRanking] = useState<DailyLeaderboardResponse | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const pendingRankingActionRef = useRef<"open" | "retry" | "submit">("open");
  const lastRequestKeyRef = useRef<string | null>(null);
  const activeRankingActionRef = useRef<"open" | "retry" | "submit">("open");

  useEffect(() => {
    let active = true;
    const requestKey = `${challengeId}:${retryNonce}:${ranked ? "ranked" : "practice"}:${savedNickname ?? ""}`;
    const isNewRequest = lastRequestKeyRef.current !== requestKey;
    const shouldSubmit = ranked && Boolean(savedNickname) && summary.score > 0;
    const action = isNewRequest
      ? pendingRankingActionRef.current === "open" && shouldSubmit
        ? "submit"
        : pendingRankingActionRef.current
      : activeRankingActionRef.current;
    if (isNewRequest && action !== "submit") {
      trackBehaviorEvent("ranking_action", {
        surface: "daily",
        action,
        difficulty: summary.difficulty,
        status: "started",
      });
    }
    if (isNewRequest) {
      lastRequestKeyRef.current = requestKey;
      activeRankingActionRef.current = action;
      pendingRankingActionRef.current = "open";
    }
    if (shouldSubmit && savedNickname) {
      setStatus("loading");
      setErrorMessage(null);
      submitDailyScore(savedNickname, challengeId, summary, {
        ranked,
        submissionId: resultSubmissionId(challengeId, summary, submissionId),
        startedAt,
        attemptToken,
      })
        .then((response) => {
          if (!active) return;
          setRanking(response);
          onViewer(response.viewer);
          setStatus("done");
          trackBehaviorEvent("ranking_action", {
            surface: "daily",
            action: shouldSubmit ? "submit_success" : action === "submit" ? "open" : action,
            difficulty: summary.difficulty,
            status: "success",
          });
        })
        .catch((error: unknown) => {
          if (!active) return;
          setStatus("error");
          setErrorMessage(
            error instanceof Error && error.message.includes("429")
              ? "本日のランキング挑戦枠（3回）を使い切っています。練習は続けられます。"
              : "ランキングを取得できませんでした。記録は端末に保存されています。",
          );
          trackBehaviorEvent("ranking_action", {
            surface: "daily",
            action: shouldSubmit ? "submit_error" : action === "submit" ? "open" : action,
            difficulty: summary.difficulty,
            status: "error",
          });
        });
    } else {
      const fetchAction = action === "submit" ? "open" : action;
      fetchDailyLeaderboard(challengeId)
        .then((response) => {
          if (!active) return;
          setRanking(response);
          onViewer(response.viewer);
          setStatus("done");
          trackBehaviorEvent("ranking_action", {
            surface: "daily",
            action: fetchAction,
            difficulty: summary.difficulty,
            status: "success",
          });
        })
        .catch(() => {
          if (!active) return;
          setStatus("error");
          setErrorMessage("ランキングを取得できませんでした。記録は端末に保存されています。");
          trackBehaviorEvent("ranking_action", {
            surface: "daily",
            action: fetchAction,
            difficulty: summary.difficulty,
            status: "error",
          });
        });
    }
    return () => {
      active = false;
    };
  }, [challengeId, ranked, retryNonce, savedNickname, summary, submissionId, startedAt, attemptToken, onViewer]);

  const submit = (): void => {
    const trimmed = nickname.trim();
    if (!trimmed) return;
    saveNickname(trimmed);
    pendingRankingActionRef.current = "submit";
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
        <div className="ranking-status ranking-error" role="alert">
          <p>{errorMessage ?? "ランキングを取得できませんでした。記録は端末に保存されています。"}</p>
          <button
            type="button"
            className="btn-ranking-submit"
            onClick={() => {
              setStatus("loading");
              setErrorMessage(null);
              pendingRankingActionRef.current = "retry";
              setRetryNonce((value) => value + 1);
            }}
          >
            もう一度読み込む
          </button>
        </div>
      )}
      {ranking?.viewer && (
        <div className="daily-viewer-rank">
          <strong>{ranking.viewer.rank}位</strong>
          <span>
            ／{ranking.viewer.total.toLocaleString()}件の登録記録・上位{ranking.viewer.percentile.toFixed(1)}%
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

/**
 * GameControllerが発行したrun IDを優先する。古い/テスト用結果にはIDがないため、
 * その場合も同じ結果画面を再表示したときに同じIDになる短期フォールバックを使う。
 */
function resultSubmissionId(
  challengeId: string,
  summary: SurvivalSummary,
  runId?: string,
): string {
  if (runId) return runId;
  const key = `typeblast.daily-submission.v1:${challengeId}:${summary.seed}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const value = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    sessionStorage.setItem(key, value);
    return value;
  } catch {
    return `run-${challengeId}-${summary.seed}`.replace(/[^A-Za-z0-9-]/g, "").slice(0, 80);
  }
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
  const [rankingUpdated, setRankingUpdated] = useState<boolean | null>(null);
  const autoSubmitStartedRef = useRef(false);

  const submitSavedNickname = (name: string): void => {
    setStatus("submitting");
    submitScore(name, summary)
      .then((result) => {
        if (result.ok) {
          markRankingSubmitted(summary);
          removePendingRankingSubmission(summary.seed);
          setRankingUpdated(result.updated);
        } else {
          enqueueRankingSubmission(summary.seed, name, summary);
        }
        setStatus(result.ok ? "done" : "error");
        trackBehaviorEvent("ranking_action", {
          surface: "world",
          action: result.ok ? "submit_success" : "submit_error",
          difficulty: summary.difficulty,
          status: result.ok ? "success" : "error",
        });
      })
      .catch(() => {
        enqueueRankingSubmission(summary.seed, name, summary);
        setStatus("error");
        trackBehaviorEvent("ranking_action", {
          surface: "world",
          action: "submit_error",
          difficulty: summary.difficulty,
          status: "error",
        });
      });
  };

  useEffect(() => {
    // APIは0点を妥当なランキング記録として受け付けない。送信欄も自動送信も出さない。
    if (summary.score <= 0 || wasRankingSubmitted(summary)) return;
    if (savedNickname && !autoSubmitStartedRef.current) {
      autoSubmitStartedRef.current = true;
      submitSavedNickname(savedNickname);
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
          <span className="ranking-submit-status">
            {rankingUpdated === false
              ? `🏆 ${savedNickname}の自己ベストは維持されています`
              : `🏆 ${savedNickname}の自己ベストをランキングへ反映しました`}
          </span>
        )}
        {status === "error" && (
          <span className="ranking-submit-status error" role="alert">
            <span>ランキングへの送信に失敗しました(スコアは手元に保存済みです)</span>
            <button
              type="button"
              className="btn-ranking-submit"
              onClick={() => {
                trackBehaviorEvent("ranking_action", {
                  surface: "world",
                  action: "retry",
                  difficulty: summary.difficulty,
                  status: "started",
                });
                submitSavedNickname(savedNickname);
              }}
            >
              もう一度送信
            </button>
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
        if (result.ok) {
          markRankingSubmitted(summary);
          removePendingRankingSubmission(summary.seed);
          setRankingUpdated(result.updated);
        } else {
          enqueueRankingSubmission(summary.seed, trimmed, summary);
        }
        setStatus(result.ok ? "done" : "error");
        trackBehaviorEvent("ranking_action", {
          surface: "world",
          action: result.ok ? "submit_success" : "submit_error",
          difficulty: summary.difficulty,
          status: result.ok ? "success" : "error",
        });
      })
      .catch(() => {
        enqueueRankingSubmission(summary.seed, trimmed, summary);
        setStatus("error");
        trackBehaviorEvent("ranking_action", {
          surface: "world",
          action: "submit_error",
          difficulty: summary.difficulty,
          status: "error",
        });
      });
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
      <button
        className="btn-ranking-skip"
        onClick={() => {
          trackBehaviorEvent("ranking_action", {
            surface: "world",
            action: "skip",
            difficulty: summary.difficulty,
            status: "success",
          });
          setSkipped(true);
        }}
      >
        今回はスキップ
      </button>
    </div>
  );
}

/**
 * 共有ボタンと共有シート(D-091)。
 * カードの描画は重いので、押されるまで build を呼ばない。
 */
function ShareAction({
  build,
  score,
  mode,
}: {
  build: () => ShareContent;
  /** 0点の記録は共有しても誰の役にも立たないため、ボタン自体を出さない */
  score: number;
  mode: "survival" | "daily" | "duel";
}): JSX.Element | null {
  const [content, setContent] = useState<ShareContent | null>(null);
  if (score <= 0) return null;

  return (
    <>
      <button
        className="btn-share"
        onClick={() => {
          trackFunnelEvent("Share Action", { action: "open", mode });
          trackBehaviorEvent("result_action", { mode, action: "share" });
          trackBehaviorEvent("share_action", { mode, action: "open", status: "started" });
          setContent(build());
        }}
      >
        <span className="btn-share-glyph" aria-hidden="true">💥</span>
        結果を共有する
      </button>
      {content && <ShareSheet content={content} mode={mode} onClose={() => setContent(null)} />}
    </>
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

function useCountUp(score: number, reducedMotion: boolean): number {
  const [displayScore, setDisplayScore] = useState(reducedMotion ? score : 0);

  useEffect(() => {
    if (reducedMotion || score <= 0) {
      setDisplayScore(score);
      return;
    }

    let animationFrame = 0;
    const durationMs = 950;
    const startedAt = performance.now();

    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(score * eased));
      if (progress < 1) {
        animationFrame = requestAnimationFrame(tick);
      }
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [score, reducedMotion]);

  return displayScore;
}

function rankOf(score: number): string {
  if (score >= 50000) return "S+";
  if (score >= 32000) return "S";
  if (score >= 20000) return "A";
  if (score >= 12000) return "B";
  if (score >= 6000) return "C";
  return "D";
}

interface SurvivalRunHighlight {
  tone: "clutch" | "burst" | "chain" | "perfect" | "steady";
  title: string;
  detail: string;
}

/**
 * 1プレイにつき1つだけ「今回の見どころ」を選ぶ。複数のバッジを並べず、
 * 結果を見た瞬間に次の挑戦理由が残るよう、優先順位を固定している。
 */
function survivalRunHighlight(summary: SurvivalSummary): SurvivalRunHighlight {
  const clutchCount = summary.clutchClearCount ?? 0;
  if (clutchCount > 0) {
    return {
      tone: "clutch",
      title: "CLUTCH CLEAR",
      detail: `${clutchCount}回、危険状態から連鎖で脱出しました`,
    };
  }
  if (summary.maxBurstTier === "max") {
    return {
      tone: "burst",
      title: "MAX BURST",
      detail: "ゲージを限界まで溜め、MAXティアに到達しました",
    };
  }
  if (summary.maxBurstTier === "power") {
    return {
      tone: "burst",
      title: "POWER BURST",
      detail: "ゲージをPOWERティアまで溜めました",
    };
  }
  if (summary.maxChain >= 5) {
    return {
      tone: "chain",
      title: `${summary.maxChain} CHAIN`,
      detail: "盤面のつながりを読み切り、大連鎖を決めました",
    };
  }
  if (summary.perfectPhraseCount >= 5) {
    return {
      tone: "perfect",
      title: "PERFECT RUN",
      detail: `${summary.perfectPhraseCount}回のPERFECTで正確に打ち抜きました`,
    };
  }
  return {
    tone: "steady",
    title: "RUN COMPLETE",
    detail: "次は連鎖候補をひとつ多くつないでみよう",
  };
}

function FocusResultCard({ progress }: { progress: FocusProgress }): JSX.Element {
  const goal = focusGoalDefinition(progress.goal);
  return (
    <section
      className={`result-focus${progress.achieved ? " result-focus-achieved" : ""}`}
      aria-label="今回の目標"
    >
      <div className="result-focus-head">
        <div>
          <span className="result-focus-kicker">FOCUS / 今回の目標</span>
          <strong>{goal.title}</strong>
        </div>
        <span className="result-focus-status">
          {progress.achieved ? "✓ 達成" : "未達成"}
        </span>
      </div>
      <p>{goal.description}</p>
      <div className="result-focus-progress" aria-label={`進捗 ${focusProgressText(progress)}`}>
        <span aria-hidden="true">
          <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
        </span>
        <strong>{focusProgressText(progress)}</strong>
      </div>
    </section>
  );
}

function NextMatchGoalCard({ summary }: { summary: NextMatchGoal }): JSX.Element {
  const previous = summary.previous;
  return (
    <section className="result-goal" aria-labelledby="result-goal-title">
      <div className="result-goal-head">
        <div>
          <span className="result-goal-kicker">NEXT MATCH GOAL</span>
          <h2 id="result-goal-title">次の一戦の目標</h2>
        </div>
        <span className="result-goal-difficulty">
          サバイバル・{SURVIVAL_DIFFICULTY_LABELS[summary.difficulty]}
        </span>
      </div>

      <p className="result-goal-target">
        次の一戦は<strong>{summary.goal.targetText}</strong>を目指す
      </p>
      <p className="result-goal-reason">理由：{summary.goal.reason}</p>

      {previous && (
        <p className="result-goal-previous">
          前回の目標「{previous.goal.targetText}」：
          <strong>
            {previous.achieved ? "✓ 達成" : "○ 未達成"}
          </strong>
        </p>
      )}
    </section>
  );
}
