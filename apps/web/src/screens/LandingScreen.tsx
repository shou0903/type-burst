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

/** 難易度ごとの一言。段が上がるほど要求される文章が長くなることを明示する */
const SURVIVAL_DIFFICULTY_HINTS: Record<SurvivalDifficulty, string> = {
  easy: "単語だけ・はじめての人へ",
  normal: "短文中心・標準の手応え",
  hard: "標準文中心・慣れた人へ",
  god: "長文のみ・容赦なし",
};

const SURVIVAL_ORDER: SurvivalDifficulty[] = ["easy", "normal", "hard", "god"];
const CPU_ORDER: CpuDifficulty[] = ["easy", "normal", "hard"];

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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    <div className="screen landing lp">
      {/* ── 計器バー: ブランド・称号の進捗・設定 ───────────────── */}
      <header className="lp-bar">
        <div className="lp-bar-brand">
          TYPE<span>BURST</span>
        </div>

        <button className="lp-rank" onClick={onShowGrowth} title="成長記録を見る">
          <span className="lp-rank-label">称号</span>
          <span className="lp-rank-name">{titleProgress.current.label}</span>
          <span className="lp-rank-track">
            <span
              className="lp-rank-fill"
              style={{ width: `${Math.round(titleProgress.progressRatio * 100)}%` }}
            />
          </span>
          <span className="lp-rank-next">
            {titleProgress.next
              ? `あと ${titleProgress.remainingToNext.toLocaleString()}`
              : "最高位に到達"}
          </span>
        </button>

        <button
          className={settingsOpen ? "lp-gear lp-gear-on" : "lp-gear"}
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          aria-label="設定（効果音・演出・文字サイズ）"
        >
          ⚙
        </button>
      </header>

      {settingsOpen && (
        <section className="lp-settings" aria-label="設定">
          <div className="lp-settings-group">
            <label className="lp-check">
              <input
                type="checkbox"
                checked={settings.soundOn}
                onChange={(e) => onUpdateSettings({ soundOn: e.target.checked })}
              />
              効果音
            </label>
            <label className="lp-check">
              <input
                type="checkbox"
                checked={settings.reducedMotion}
                onChange={(e) => onUpdateSettings({ reducedMotion: e.target.checked })}
              />
              演出を控えめにする
            </label>
            <label className="lp-check">
              <input
                type="checkbox"
                checked={settings.highContrast}
                onChange={(e) => onUpdateSettings({ highContrast: e.target.checked })}
              />
              High Contrast
            </label>
          </div>
          <div className="lp-settings-group">
            <span className="lp-settings-label">文字サイズ</span>
            <div className="lp-seg lp-seg-sm" role="group" aria-label="文字サイズ">
              {FONT_SCALE_LABELS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={settings.fontScale === value}
                  onClick={() => onUpdateSettings({ fontScale: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── ヒーロー: 主張と実演を横並びにする ─────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-main">
          <h1 className="lp-logo">
            TYPE
            <span className="lp-logo-burst">BURST</span>
          </h1>

          <p className="lp-tagline">
            TYPE BURST（タイプバースト）は、日本語を打ってブロックを爆破する無料タイピングゲーム。
            <strong>速さだけでなく「どこを消すか」</strong>で盤面が変わる、連鎖パズルです。
          </p>

          <ul className="lp-badges">
            <li>完全無料</li>
            <li>登録不要</li>
            <li>ブラウザですぐ</li>
          </ul>

          <button
            className="lp-cta"
            onClick={() => onStart({ type: "survival", difficulty: survivalDifficulty })}
          >
            <span className="lp-cta-play" aria-hidden="true" />
            <span className="lp-cta-text">サバイバルを始める</span>
            <span className="lp-cta-key">ENTER</span>
          </button>

          <div className="lp-seg" role="group" aria-label="サバイバルの難易度">
            {SURVIVAL_ORDER.map((d, i) => (
              <button
                key={d}
                type="button"
                data-lv={i + 1}
                aria-pressed={d === survivalDifficulty}
                onClick={() => setSurvivalDifficulty(d)}
              >
                {SURVIVAL_DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </div>

          <p className="lp-hint">
            <span className="lp-hint-dot" data-lv={SURVIVAL_ORDER.indexOf(survivalDifficulty) + 1} />
            {SURVIVAL_DIFFICULTY_HINTS[survivalDifficulty]}
            {best > 0 && (
              <>
                <span className="lp-hint-sep" aria-hidden="true">
                  /
                </span>
                自己ベスト <strong>{best.toLocaleString()}</strong>
              </>
            )}
          </p>
        </div>

        <figure className="lp-stage">
          {/* 実エンジン(PlayerCore)の自動プレイ。モバイル誘導ページと同じ
              AttractBoardを流用し、「面白そう」を1秒で伝える(D-074) */}
          <AttractBoard reducedMotion={settings.reducedMotion} />
          <figcaption>
            <span className="lp-stage-live" aria-hidden="true" />
            実際のゲーム画面（自動プレイ中）
          </figcaption>
        </figure>
      </section>

      {/* ── 副次導線: 対戦と3つの入口 ─────────────────────────── */}
      <section className="lp-tiles">
        <div className="lp-tile lp-tile-duel">
          <div className="lp-tile-top">
            <span className="lp-tile-kicker">VS CPU</span>
            <h2 className="lp-tile-name">CPUと対戦</h2>
          </div>
          <div className="lp-seg lp-seg-sm" role="group" aria-label="CPUの強さ">
            {CPU_ORDER.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={d === difficulty}
                onClick={() => setDifficulty(d)}
              >
                {DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </div>
          <p className="lp-tile-meta">
            {DIFFICULTY_LABELS[difficulty]}
            <span> / {record[difficulty].wins}勝 {record[difficulty].losses}敗</span>
          </p>
          <button className="lp-tile-go" onClick={() => onStart({ type: "duel", difficulty })}>
            対戦する
          </button>
        </div>

        <button className="lp-tile lp-tile-link" onClick={onShowRanking}>
          <span className="lp-tile-icon" aria-hidden="true">
            🏆
          </span>
          <span className="lp-tile-name">世界ランキング</span>
          <span className="lp-tile-sub">難易度別・全期間</span>
        </button>

        <button className="lp-tile lp-tile-link" onClick={onShowGrowth}>
          <span className="lp-tile-icon" aria-hidden="true">
            📈
          </span>
          <span className="lp-tile-name">成長記録</span>
          <span className="lp-tile-sub">KPM・正確率の推移</span>
        </button>

        <button className="lp-tile lp-tile-link" onClick={() => onStart({ type: "tutorial" })}>
          <span className="lp-tile-icon" aria-hidden="true">
            📖
          </span>
          <span className="lp-tile-name">チュートリアル</span>
          <span className="lp-tile-sub">7ステップで基本を</span>
        </button>
      </section>

      <DailyChallengeCard progress={dailyProgress} onStart={onStart} />

      {/* ── 遊び方 ─────────────────────────────────────────────── */}
      <button
        className="lp-disclosure"
        onClick={() => setHowtoOpen((open) => !open)}
        aria-expanded={howtoOpen}
      >
        {howtoOpen ? "遊び方を閉じる ▲" : "遊び方を見る（はじめての方はこちら） ▼"}
      </button>

      {howtoOpen && (
        <ol className="lp-howto">
          <li>消したいブロックの日本語をローマ字で入力。打ち切ると爆発します。</li>
          <li>同じ色が3個つながると全部消え、落下後に4個つながると自動で連鎖します。</li>
          <li>ゲージが満タンになったら Enter で TYPE BURST（下3行を吹き飛ばす）。</li>
          <li>💣ボムは周囲を爆破、🌈プリズムは同色を全消し。全消しで ALL CLEAR ボーナス。</li>
          <li>新しいブロックは上から降ってきます。選択のやり直しは Esc / Backspace。</li>
        </ol>
      )}

      <p className="lp-note">※ 日本語IMEはOFF（半角英数）にしてプレイしてください。登録は不要です。</p>

      <footer className="lp-footer">
        <a href="/about.html">TYPE BURSTとは</a>
        <a href="/terms.html" target="_blank" rel="noreferrer">
          利用規約
        </a>
        <a href="/privacy.html" target="_blank" rel="noreferrer">
          プライバシーポリシー
        </a>
      </footer>
    </div>
  );
}
