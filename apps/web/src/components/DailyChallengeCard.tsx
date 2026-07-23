import {
  DAILY_RANKED_ATTEMPTS,
  dailyAttempts,
  dailyBestScore,
  dailyChallengeId,
  isDailyRankedAttempt,
  type DailyProgress,
} from "../daily";
import type { GameMode } from "../game/GameController";

interface Props {
  progress: DailyProgress;
  onStart: (mode: GameMode) => void;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function DailyChallengeCard({ progress, onStart }: Props): JSX.Element {
  const challengeId = dailyChallengeId();
  const attempts = dailyAttempts(progress, challengeId);
  const remaining = Math.max(0, DAILY_RANKED_ATTEMPTS - attempts);
  const best = dailyBestScore(progress, challengeId);
  const ranked = isDailyRankedAttempt(progress, challengeId);

  return (
    <section className="daily-card">
      <div className="daily-card-main">
        <div className="daily-heading-row">
          <div>
            <div className="daily-kicker">2分間・全員共通ステージ</div>
            <h2 className="daily-title">今日のTYPE BURST</h2>
          </div>
          <div className="daily-date">{formatJapaneseDate(challengeId)}</div>
        </div>
        <p className="daily-description">
          今日だけの同じ盤面で全国のプレイヤーと競います。記録挑戦は1日3回、以降は何度でも練習できます。
        </p>
        <div className="daily-stats">
          <DailyStat label="連続記録" value={`🔥 ${progress.currentStreak}日`} />
          <DailyStat label="今日のベスト" value={best > 0 ? best.toLocaleString() : "未挑戦"} />
          <DailyStat
            label={ranked ? "記録挑戦" : "本日は練習"}
            value={ranked ? `残り${remaining}回` : "無制限"}
          />
          <DailyStat label="お休み券" value={`${progress.freezes}枚`} />
        </div>
        <button
          className="btn-daily"
          onClick={() => onStart({ type: "daily", challengeId, ranked })}
        >
          {ranked ? "今日の記録に挑戦" : "今日のステージを練習"}
          <span className="btn-sub">2:00</span>
        </button>
      </div>
      <DailyCalendar progress={progress} challengeId={challengeId} />
    </section>
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
              title={played ? "プレイ済み" : protectedDay ? "お休み券で保護" : ""}
            >
              {played ? "🔥" : protectedDay ? "◇" : day}
            </span>
          );
        })}
      </div>
      <div className="daily-calendar-note">7日連続ごとにお休み券を1枚獲得（最大2枚）</div>
    </div>
  );
}

function formatJapaneseDate(challengeId: string): string {
  const [, month, day] = challengeId.split("-");
  return `${Number(month)}月${Number(day)}日`;
}
