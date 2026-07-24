import { useEffect, useMemo, useState } from "react";
import type { CpuDifficulty, SurvivalDifficulty } from "@type-burst/game-core";
import { titleProgressForScore, type LifetimeProgress } from "@type-burst/progression";
import type { GameMode } from "../game/GameController";
import { bestScore, loadDuelRecord, type FontScale, type Settings, type StoredResult } from "../storage";
import type { DailyProgress } from "../daily";
import { DailyChallengeCard } from "../components/DailyChallengeCard";
import { AttractBoard } from "../components/AttractBoard";

const FONT_SCALE_LABELS: Array<{ value: FontScale; label: string }> = [
  { value: 1, label: "標準" },
  { value: 1.15, label: "大" },
  { value: 1.3, label: "特大" },
];

interface Props {
  settings: Settings;
  results: StoredResult[];
  progress: LifetimeProgress;
  dailyProgress: DailyProgress;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onStart: (mode: GameMode) => void;
  onShowRanking: () => void;
  onShowGrowth: () => void;
}

const DIFFICULTY_LABELS: Record<CpuDifficulty, string> = {
  easy: "弱い",
  normal: "普通",
  hard: "強い",
};

const SURVIVAL_DIFFICULTY_LABELS: Record<SurvivalDifficulty, string> = {
  easy: "初級",
  normal: "中級",
  hard: "上級",
  god: "神級",
};

export function LandingScreen({
  settings,
  results,
  progress,
  dailyProgress,
  onUpdateSettings,
  onStart,
  onShowRanking,
  onShowGrowth,
}: Props): JSX.Element {
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("normal");
  const [survivalDifficulty, setSurvivalDifficulty] = useState<SurvivalDifficulty>("normal");
  const [howtoOpen, setHowtoOpen] = useState(false);
  const best = bestScore(results, survivalDifficulty);
  const record = loadDuelRecord();
  const titleProgress = useMemo(() => titleProgressForScore(progress.totalScore), [progress.totalScore]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // ボタン・チェックボックス等にフォーカスがある場合は、ネイティブの
      // Enter/Space操作を優先する。ここで横取りすると、設定をSpaceで切り替えた
      // だけなのにサバイバルが始まるなど、キーボード操作が破綻する(D-060)。
      const target = e.target;
      if (
        e.defaultPrevented ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest("button, input, select, textarea, a[href]") !== null))
      ) {
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onStart({ type: "survival", difficulty: survivalDifficulty });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onStart, survivalDifficulty]);

  return (
    <div className="screen landing">
      <div className="hero hero-with-demo">
        <div className="hero-pitch">
          <h1 className="logo">
            TYPE <span className="logo-burst">BURST</span>
          </h1>
          <p className="tagline">
            TYPE BURST（タイプバースト）は、日本語を打ってブロックを爆破する無料タイピングゲーム。
            連鎖で盤面を吹き飛ばそう。
          </p>
          <div className="hero-badges">
            <span className="hero-badge">完全無料</span>
            <span className="hero-badge">登録不要</span>
            <span className="hero-badge">ブラウザですぐ</span>
          </div>
        </div>
        <div className="hero-demo">
          {/* 実エンジン(PlayerCore)の自動プレイをそのまま見せ、「面白そう」を1秒で伝える。
              モバイル誘導ページ(MobileLanding)と同じAttractBoardを流用(D-074)。 */}
          <AttractBoard reducedMotion={settings.reducedMotion} />
          <p className="hero-demo-caption">実際のゲーム画面(自動プレイ中)</p>
        </div>
      </div>

      <button className="title-badge-box" onClick={onShowGrowth} title="成長記録を見る">
        <div className="title-badge-label">称号</div>
        <div className="title-badge-name">{titleProgress.current.label}</div>
        <div className="title-progress-bar">
          <div
            className="title-progress-fill"
            style={{ width: `${Math.round(titleProgress.progressRatio * 100)}%` }}
          />
        </div>
        <div className="title-badge-next">
          {titleProgress.next
            ? `あと${titleProgress.remainingToNext.toLocaleString()}で『${titleProgress.next.label}』`
            : "最高位の称号に到達しました!"}
        </div>
      </button>

      <div className="mode-row">
        <div className="duel-box">
          <button
            className="btn-primary"
            onClick={() => onStart({ type: "survival", difficulty: survivalDifficulty })}
          >
            サバイバル <span className="btn-sub">Enter</span>
          </button>
          <div className="difficulty-row">
            {(Object.keys(SURVIVAL_DIFFICULTY_LABELS) as SurvivalDifficulty[]).map((d) => (
              <button
                key={d}
                className={d === survivalDifficulty ? "chip chip-active" : "chip"}
                onClick={() => setSurvivalDifficulty(d)}
              >
                {SURVIVAL_DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </div>
        </div>
        <div className="duel-box">
          <button
            className="btn-duel"
            onClick={() => onStart({ type: "duel", difficulty })}
          >
            CPUと対戦
          </button>
          <div className="difficulty-row">
            {(Object.keys(DIFFICULTY_LABELS) as CpuDifficulty[]).map((d) => (
              <button
                key={d}
                className={d === difficulty ? "chip chip-active" : "chip"}
                onClick={() => setDifficulty(d)}
              >
                {DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </div>
          <div className="duel-record">
            {DIFFICULTY_LABELS[difficulty]}: {record[difficulty].wins}勝 {record[difficulty].losses}敗
          </div>
        </div>
      </div>

      {best > 0 && (
        <p className="best-score">
          サバイバル({SURVIVAL_DIFFICULTY_LABELS[survivalDifficulty]}) ベストスコア:{" "}
          <strong>{best.toLocaleString()}</strong>
        </p>
      )}

      <div className="quick-links-row">
        <button className="btn-tutorial-link" onClick={() => onStart({ type: "tutorial" })}>
          📖 チュートリアル
        </button>
        <button className="btn-ranking-link" onClick={onShowRanking}>
          🏆 世界ランキング
        </button>
        <button className="btn-growth-link" onClick={onShowGrowth}>
          📈 成長記録
        </button>
      </div>

      <DailyChallengeCard progress={dailyProgress} onStart={onStart} />

      <button
        className="btn-howto-toggle"
        onClick={() => setHowtoOpen((open) => !open)}
        aria-expanded={howtoOpen}
      >
        {howtoOpen ? "遊び方を閉じる ▲" : "遊び方を見る(はじめての方はこちら) ▼"}
      </button>

      {howtoOpen && (
        <div className="howto">
          <div className="howto-step">
            <span className="howto-num">1</span>
            <span>消したいブロックの日本語をローマ字で入力。完成で爆発!</span>
          </div>
          <div className="howto-step">
            <span className="howto-num">2</span>
            <span>同じ色3個で全消し、落下で4個つながると自動連鎖</span>
          </div>
          <div className="howto-step">
            <span className="howto-num">3</span>
            <span>ゲージが満タンになったら Enter で TYPE BURST!(下3行を吹き飛ばす)</span>
          </div>
          <div className="howto-step">
            <span className="howto-num">4</span>
            <span>💣ボム=周囲爆破 / 🌈プリズム=同色全消し。全消しで ALL CLEAR ボーナス!</span>
          </div>
          <div className="howto-step">
            <span className="howto-num">5</span>
            <span>新しいブロックは上から降ってくる。選択の取り消しは Esc / Backspace</span>
          </div>
        </div>
      )}

      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={settings.soundOn}
            onChange={(e) => onUpdateSettings({ soundOn: e.target.checked })}
          />
          効果音
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(e) => onUpdateSettings({ reducedMotion: e.target.checked })}
          />
          演出を控えめにする
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.highContrast}
            onChange={(e) => onUpdateSettings({ highContrast: e.target.checked })}
          />
          High Contrast
        </label>
      </div>

      <div className="settings-row font-scale-row">
        <span className="font-scale-label">文字サイズ</span>
        {FONT_SCALE_LABELS.map(({ value, label }) => (
          <button
            key={value}
            className={settings.fontScale === value ? "chip chip-active" : "chip"}
            onClick={() => onUpdateSettings({ fontScale: value })}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="ime-note">※ 日本語IMEはOFF(半角英数)にしてプレイしてください。登録は不要です。</p>

      <div className="footer-links">
        <a href="/about.html">TYPE BURSTとは</a>
        <span aria-hidden="true">・</span>
        <a href="/terms.html" target="_blank" rel="noreferrer">
          利用規約
        </a>
        <span aria-hidden="true">・</span>
        <a href="/privacy.html" target="_blank" rel="noreferrer">
          プライバシーポリシー
        </a>
      </div>
    </div>
  );
}
