import { useEffect, useMemo, useState } from "react";
import type { CpuDifficulty, SurvivalDifficulty } from "@type-burst/game-core";
import { titleProgressForScore, type LifetimeProgress } from "@type-burst/progression";
import type { GameMode } from "../game/GameController";
import { bestScore, loadDuelRecord, type FontScale, type Settings, type StoredResult } from "../storage";
import type { DailyProgress } from "../daily";
import { DailyChallengeCard } from "../components/DailyChallengeCard";
import { AttractBoard } from "../components/AttractBoard";
import { RomajiTicker } from "../components/RomajiTicker";
import { GrowthDeck, RankingDeck, TutorialDeck } from "../components/HomeDecks";
import { HERO_RENDERER_OPTIONS } from "../render/BoardRenderer";

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

/**
 * サバイバル難易度の表示定義。
 *
 * 形と色は盤面の4属性(BoardRenderer の ATTRIBUTE_STYLES)からそのまま借りている。
 * 風◆(緑) → 水●(青) → 光★(金) → 火▲(赤) の順で、段が上がるほど色が熱くなる。
 * 新しい色や記号を発明せず、ゲーム本体の語彙だけでUIを組むための選択。
 */
const SURVIVAL_TIERS: Array<{
  id: SurvivalDifficulty;
  label: string;
  glyph: string;
  hint: string;
}> = [
  { id: "easy", label: "初級", glyph: "◆", hint: "単語だけ。はじめての人へ" },
  { id: "normal", label: "中級", glyph: "●", hint: "短文中心。標準の手応え" },
  { id: "hard", label: "上級", glyph: "★", hint: "標準文中心。慣れた人へ" },
  { id: "god", label: "神級", glyph: "▲", hint: "長文のみ。容赦なし" },
];

const CPU_ORDER: CpuDifficulty[] = ["easy", "normal", "hard"];

/**
 * 記事から来た人には、本文で案内した難易度を最初から選択して見せる。
 * 音声の有効化と誤操作防止のため、ゲーム開始自体は必ず本人のクリックに任せる。
 */
function guideSurvivalDifficulty(): SurvivalDifficulty | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") !== "survival") return null;

  const difficulty = params.get("difficulty");
  return difficulty === "easy" || difficulty === "normal" || difficulty === "hard" || difficulty === "god"
    ? difficulty
    : null;
}

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
  const [guideDifficulty] = useState<SurvivalDifficulty | null>(guideSurvivalDifficulty);
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("normal");
  const [survivalDifficulty, setSurvivalDifficulty] = useState<SurvivalDifficulty>(
    () => guideDifficulty ?? "normal",
  );
  const [howtoOpen, setHowtoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const best = bestScore(results, survivalDifficulty);
  const record = loadDuelRecord();
  const titleProgress = useMemo(() => titleProgressForScore(progress.totalScore), [progress.totalScore]);
  const activeTier = SURVIVAL_TIERS.find((t) => t.id === survivalDifficulty) ?? SURVIVAL_TIERS[1]!;

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

  useEffect(() => {
    if (guideDifficulty === null) return;
    document.getElementById("play")?.focus({ preventScroll: true });
  }, [guideDifficulty]);

  return (
    <div className="screen landing lp">
      {/* ── 上部レール ──────────────────────────────────────── */}
      <header className="lp-rail">
        <div className="lp-mark">
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
              ? `NEXT ${titleProgress.remainingToNext.toLocaleString()}`
              : "MAX"}
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
            <div className="lp-pills" role="group" aria-label="文字サイズ">
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

      {/* ── ヒーロー ────────────────────────────────────────── */}
      <section className="lp-hero">
        {/* 環境演出: 盤面の爆発パーティクルと同じ属性色の残り火が立ち上る。
            装飾のみ・CSSアニメーションのみで、reduced-motion時は消える(D-085) */}
        <div className="lp-embers" aria-hidden="true">
          <span /><span /><span /><span /><span /><span /><span />
        </div>

        <div className="lp-hero-copy">
          <h1 className="lp-logo">
            <span className="lp-logo-type">TYPE</span>
            <span className="lp-logo-burst">BURST</span>
            <span className="lp-logo-ja">タイプバースト</span>
          </h1>

          <p className="lp-lede">
            TYPE BURST（タイプバースト）は、日本語を打ってブロックを爆破する無料タイピングゲーム。
            <strong>速さだけでなく「どこを消すか」</strong>で盤面が変わる、連鎖パズルです。
          </p>

          <ul className="lp-facts">
            <li>完全無料</li>
            <li>登録不要</li>
            <li>ブラウザですぐ</li>
          </ul>

          {/* 主行動: 盤面のブロックと同じ質感で描き、押すと沈んで「爆破」する */}
          <button
            id="play"
            className="lp-play"
            onClick={() => onStart({ type: "survival", difficulty: survivalDifficulty })}
          >
            <span className="lp-play-face">
              <span className="lp-play-glyph" aria-hidden="true">
                ▲
              </span>
              <span className="lp-play-label">サバイバルを始める</span>
              <span className="lp-play-key">ENTER</span>
            </span>
          </button>

          <div className="lp-tiers" role="group" aria-label="サバイバルの難易度">
            {SURVIVAL_TIERS.map((tier, i) => (
              <button
                key={tier.id}
                type="button"
                className="lp-tier"
                data-lv={i + 1}
                aria-pressed={tier.id === survivalDifficulty}
                onClick={() => setSurvivalDifficulty(tier.id)}
              >
                <span className="lp-tier-glyph" aria-hidden="true">
                  {tier.glyph}
                </span>
                <span className="lp-tier-label">{tier.label}</span>
              </button>
            ))}
          </div>

          <p className="lp-tier-hint" data-lv={SURVIVAL_TIERS.indexOf(activeTier) + 1}>
            {activeTier.hint}
            {best > 0 && (
              <>
                <span className="lp-sep" aria-hidden="true">
                  ・
                </span>
                自己ベスト <strong>{best.toLocaleString()}</strong>
              </>
            )}
          </p>
        </div>

        <div className="lp-hero-stage">
          <div className="lp-stage-frame">
            {/* 実エンジン(PlayerCore)の自動プレイ。動画やモックではなく本物(D-074) */}
            <AttractBoard reducedMotion={settings.reducedMotion} options={HERO_RENDERER_OPTIONS} />
          </div>
          {/* このゲームにしかない画: 打った所と残りのローマ字 */}
          <RomajiTicker reducedMotion={settings.reducedMotion} />
          <p className="lp-stage-note">
            <span className="lp-stage-live" aria-hidden="true" />
            実際のゲーム画面（自動プレイ中）
          </p>
        </div>
      </section>

      {/* ── 副次導線 ────────────────────────────────────────── */}
      <section className="lp-decks">
        <div className="lp-deck lp-deck-duel">
          <div className="lp-deck-head">
            <span className="lp-deck-kicker">VS CPU</span>
            <h2 className="lp-deck-title">CPUと対戦</h2>
          </div>
          <div className="lp-pills" role="group" aria-label="CPUの強さ">
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
          <p className="lp-deck-meta">
            {DIFFICULTY_LABELS[difficulty]} ・ {record[difficulty].wins}勝 {record[difficulty].losses}敗
          </p>
          <button className="lp-deck-go" onClick={() => onStart({ type: "duel", difficulty })}>
            対戦する
          </button>
        </div>

        <RankingDeck difficulty={survivalDifficulty} onOpen={onShowRanking} />
        <GrowthDeck progress={progress} results={results} onOpen={onShowGrowth} />
        <TutorialDeck onOpen={() => onStart({ type: "tutorial" })} />
      </section>

      <DailyChallengeCard progress={dailyProgress} onStart={onStart} />

      {/* ── 遊び方 ──────────────────────────────────────────── */}
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
        <a href="/about.html">TYPE BURST（タイプバースト）とは</a>
        <a href="/guides">タイピング練習ガイド</a>
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
