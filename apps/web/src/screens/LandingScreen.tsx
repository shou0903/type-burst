import { useEffect, useState } from "react";
import type { CpuDifficulty } from "@type-blast/game-core";
import type { GameMode } from "../game/GameController";
import { useFitToViewport } from "../hooks/useFitToViewport";
import { bestScore, loadDuelRecord, type FontScale, type Settings, type StoredResult } from "../storage";

const FONT_SCALE_LABELS: Array<{ value: FontScale; label: string }> = [
  { value: 1, label: "標準" },
  { value: 1.15, label: "大" },
  { value: 1.3, label: "特大" },
];

interface Props {
  settings: Settings;
  results: StoredResult[];
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onStart: (mode: GameMode) => void;
}

const DIFFICULTY_LABELS: Record<CpuDifficulty, string> = {
  easy: "よわい",
  normal: "ふつう",
  hard: "つよい",
};

export function LandingScreen({ settings, results, onUpdateSettings, onStart }: Props): JSX.Element {
  const best = bestScore(results);
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("normal");
  const record = loadDuelRecord();
  const { ref, style } = useFitToViewport<HTMLDivElement>();

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onStart({ type: "survival" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onStart]);

  return (
    <div ref={ref} style={style} className="screen landing">
      <h1 className="logo">
        TYPE <span className="logo-blast">BLAST</span>
      </h1>
      <p className="tagline">日本語を打ってブロックを爆破。連鎖で盤面を吹き飛ばそう。</p>

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

      <div className="mode-row">
        <button className="btn-primary" onClick={() => onStart({ type: "survival" })} autoFocus>
          サバイバル <span className="btn-sub">Enter</span>
        </button>
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
          サバイバル ベストスコア: <strong>{best.toLocaleString()}</strong>
        </p>
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
