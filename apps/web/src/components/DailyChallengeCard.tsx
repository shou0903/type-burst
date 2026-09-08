import { useCallback, useEffect, useRef, useState } from "react";
import {
  DAILY_RANKED_ATTEMPTS,
  dailyAttempts,
  dailyBestScore,
  dailyChallengeId,
  isDailyRankedAttempt,
  type DailyProgress,
} from "../daily";
import {
  fetchDailyLeaderboard,
  type DailyLeaderboardResponse,
} from "../dailyRanking";
import type { GameMode } from "../game/GameController";
import { trackBehaviorEvent } from "../behaviorTelemetry";

interface Props {
  progress: DailyProgress;
  onStart: (mode: GameMode) => void | Promise<void>;
  starting?: boolean;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function DailyChallengeCard({ progress, onStart, starting = false }: Props): JSX.Element {
  const [challengeId, setChallengeId] = useState(dailyChallengeId);
  const attempts = dailyAttempts(progress, challengeId);
  const remaining = Math.max(0, DAILY_RANKED_ATTEMPTS - attempts);
  const best = dailyBestScore(progress, challengeId);
  const ranked = isDailyRankedAttempt(progress, challengeId);

  useEffect(() => {
    const refreshDate = (): void => setChallengeId(dailyChallengeId());
    const timer = window.setInterval(refreshDate, 60_000);
    window.addEventListener("focus", refreshDate);
    document.addEventListener("visibilitychange", refreshDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshDate);
      document.removeEventListener("visibilitychange", refreshDate);
    };
  }, []);

  return (
    <section className="daily-card">
      <div className="daily-heading-row">
        <div>
          <div className="daily-kicker">DAILY CHALLENGE・全員共通の2分間</div>
          <h2 className="daily-title">今日のTYPE BURST</h2>
        </div>
        <div className="daily-date">{formatJapaneseDate(challengeId)}</div>
      </div>

      <div className="daily-card-grid">
        <div className="daily-card-main">
          <p className="daily-description">
            盤面は最初から満杯。ボム・プリズム・TYPE BURSTを使って全消しすると、
            次の満杯盤面が即スタートします。2分間、止まらずスコアを伸ばそう。
          </p>
          <ul className="daily-rules">
            <li>制限時間は2:00。最高スコアを競います</li>
            <li>ランキング挑戦は1日3回まで</li>
            <li>4回目以降は練習（ランキング外）</li>
          </ul>

          <div className="daily-stats">
            <DailyStat label="今日のベスト" value={best > 0 ? best.toLocaleString() : "未挑戦"} />
            <DailyStat
              label="ランキング挑戦（残り）"
              value={ranked ? `${remaining}/3回` : "0/3回"}
            />
          </div>

          <button
            className="btn-daily"
            disabled={starting}
            onClick={() => onStart({ type: "daily", challengeId, ranked })}
          >
            <span>{starting ? "チャレンジを準備中…" : ranked ? "今日のランキングに挑戦" : "同じステージを練習"}</span>
            <span className="btn-sub">2:00</span>
          </button>
          <p className="daily-attempt-help">
            {ranked
              ? `ランキング対象は残り${remaining}回。練習は何度でも可能です`
              : "本日のランキング枠は終了。練習スコアは送信されません"}
          </p>
        </div>

        <DailyLeaderboardPreview challengeId={challengeId} />
      </div>

      <div className="daily-continuity">
        <div className="daily-continuity-summary">
          <div>
            <span className="daily-continuity-label">毎日プレイ記録</span>
            <strong>🔥 {progress.currentStreak}日連続</strong>
            <small>最長 {progress.bestStreak}日</small>
          </div>
          <div className="daily-protection">
            <span>連続記録保護</span>
            <strong>{progress.freezes}回分</strong>
          </div>
        </div>
        <p className="daily-continuity-explanation">
          1日1回プレイすると連続日数が伸びます。7日続けると、
          <strong>1日休んでも記録が途切れない保護</strong>を1回獲得し、必要な日に自動で使われます。
        </p>
        <details className="daily-calendar-details">
          <summary>プレイカレンダーを見る</summary>
          <DailyCalendar progress={progress} challengeId={challengeId} />
        </details>
      </div>
    </section>
  );
}

function DailyLeaderboardPreview({ challengeId }: { challengeId: string }): JSX.Element {
  const [ranking, setRanking] = useState<DailyLeaderboardResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [expanded, setExpanded] = useState(false);
  const pendingActionRef = useRef<"open" | "retry">("open");
  const didInitialLoadRef = useRef(false);
  const requestIdRef = useRef(0);
  const lastLoadedAtRef = useRef(0);

  const load = useCallback((force = false): void => {
    const now = Date.now();
    // ホームを表示したままの過剰な再取得を避けつつ、タブ復帰時には
    // 他のプレイヤーの結果を取り込む。手動再試行は常に許可する。
    if (!force && now - lastLoadedAtRef.current < 15_000) return;
    lastLoadedAtRef.current = now;
    const requestId = ++requestIdRef.current;
    const action = pendingActionRef.current;
    const shouldTrack = action === "retry" || !didInitialLoadRef.current;
    if (shouldTrack) {
      trackBehaviorEvent("ranking_action", { surface: "daily", action, status: "started" });
      didInitialLoadRef.current = true;
      pendingActionRef.current = "open";
    }
    setStatus("loading");
    fetchDailyLeaderboard(challengeId)
      .then((response) => {
        if (requestId !== requestIdRef.current) return;
        setRanking(response);
        setStatus("done");
        if (shouldTrack) {
          trackBehaviorEvent("ranking_action", { surface: "daily", action, status: "success" });
        }
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setStatus("error");
        if (shouldTrack) {
          trackBehaviorEvent("ranking_action", { surface: "daily", action, status: "error" });
        }
      });
  }, [challengeId]);

  useEffect(() => {
    load(true);
    const refresh = (): void => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  return (
    <aside className="daily-leaderboard-preview" aria-live="polite">
      <div className="daily-leaderboard-head">
        <div>
          <span>本日のランキング</span>
          <strong>{ranking ? `${ranking.total.toLocaleString()}件の登録記録` : "集計中"}</strong>
        </div>
        <span className="daily-live-label">TODAY</span>
      </div>

      {status === "loading" && (
        <div className="daily-ranking-loading" role="status" aria-live="polite">
          ランキングを読み込んでいます…
        </div>
      )}
      {status === "error" && (
        <div className="daily-ranking-error" role="alert" aria-live="polite">
          <p>ランキングを取得できませんでした。</p>
          <button
            onClick={() => {
              pendingActionRef.current = "retry";
              load(true);
            }}
          >
            再読み込み
          </button>
        </div>
      )}
      {status === "done" && ranking?.viewer && (
        <div className="daily-my-rank">
          <span>あなたの今日の順位</span>
          <div>
            <strong>{ranking.viewer.rank}位</strong>
            <small>／ {ranking.viewer.total.toLocaleString()}件の登録記録</small>
          </div>
          <div className="daily-my-rank-details">
            <span>上位 {ranking.viewer.percentile.toFixed(1)}%</span>
            <span>
              {ranking.viewer.scoreToNext === null
                ? "現在1位"
                : `次の順位まであと ${ranking.viewer.scoreToNext.toLocaleString()}点`}
            </span>
          </div>
        </div>
      )}
      {status === "done" && ranking && !ranking.viewer && (
        <div className="daily-rank-guidance">
          {ranking.total > 0
            ? "挑戦後、あなたの順位・上位割合・次の順位までの点差がここに表示されます。"
            : "まだ記録はありません。今日最初のランカーになろう！"}
        </div>
      )}

      {status === "done" && ranking && ranking.entries.length > 0 && (
        <ol className={`daily-ranking-preview-list${expanded ? " is-expanded" : ""}`}>
          {ranking.entries.slice(0, expanded ? 100 : 5).map((entry) => (
            <li key={`${entry.rank}-${entry.nickname}`}>
              <span className="daily-preview-rank">{entry.rank}</span>
              <span className="daily-preview-name">{entry.nickname}</span>
              <strong>{entry.score.toLocaleString()}</strong>
            </li>
          ))}
        </ol>
      )}
      {status === "done" && ranking && ranking.entries.length > 5 && (
        <button
          className="daily-ranking-expand"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          {expanded
            ? "ランキングを閉じる"
            : `ランキングをもっと見る（上位100件中・全${ranking.total.toLocaleString()}件）`}
        </button>
      )}
    </aside>
  );
}

function DailyStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="daily-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DailyCalendar({
  progress,
  challengeId,
}: {
  progress: DailyProgress;
  challengeId: string;
}): JSX.Element {
  const [yearPart, monthPart] = challengeId.split("-");
  const year = Number(yearPart ?? "1970");
  const month = Number(monthPart ?? "1");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  return (
    <div className="daily-calendar">
      <div className="daily-calendar-title">
        {year}年{month}月
      </div>
      <div className="daily-calendar-grid">
        {WEEKDAYS.map((weekday) => (
          <span className="daily-weekday" key={weekday}>{weekday}</span>
        ))}
        {cells.map((day, index) => {
          if (day === null) return <span key={`blank-${index}`} />;
          const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const played = progress.playedDates.includes(date);
          const protectedDay = progress.protectedDates.includes(date);
          const today = date === challengeId;
          return (
            <span
              key={date}
              className={`daily-calendar-day${played ? " played" : ""}${protectedDay ? " protected" : ""}${today ? " today" : ""}`}
              title={played ? "プレイ済み" : protectedDay ? "連続記録を保護した日" : ""}
            >
              {played ? "🔥" : protectedDay ? "◇" : day}
            </span>
          );
        })}
      </div>
      <div className="daily-calendar-note">
        🔥 プレイした日　◇ 連続記録を保護した日
      </div>
    </div>
  );
}

function formatJapaneseDate(challengeId: string): string {
  const [, month, day] = challengeId.split("-");
  return `${Number(month)}月${Number(day)}日`;
}
