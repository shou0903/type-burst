import { useEffect, useMemo, useState } from "react";
import type { CpuDifficulty, SurvivalDifficulty } from "@type-burst/game-core";
import { titleProgressForScore, type LifetimeProgress } from "@type-burst/progression";
import type { GameMode } from "../game/GameController";
import { bestScore, loadDuelRecord, type FontScale, type Settings, type StoredResult } from "../storage";
import type { DailyProgress } from "../daily";
import { DailyChallengeCard } from "../components/DailyChallengeCard";
import { DataTransferSection } from "../components/DataTransferSection";
import { AdSlots } from "../components/AdSlots";
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
  const firstPlay = progress.totalGames === 0;
  const [survivalDifficulty, setSurvivalDifficulty] = useState<SurvivalDifficulty>(
    () => guideDifficulty ?? (firstPlay ? "easy" : "normal"),
  );
  const [howtoOpen, setHowtoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const survivalResults = useMemo(() => results.filter((entry) => entry.mode !== "daily"), [results]);
  const best = bestScore(survivalResults, survivalDifficulty);
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
      <AdSlots />
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

      <nav className="lp-primary-nav" aria-label="サイト内メニュー">
        <a href="/" aria-current="page">ゲーム</a>
        <a href="/about.html">遊び方・特徴</a>
        <a href="/guides">タイピング練習ガイド</a>
        <a href="/tools">無料測定ツール</a>
      </nav>

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
          <DataTransferSection />
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

          {firstPlay && (
            <section className="lp-first-play" aria-label="初回プレイ案内">
              <div>
                <span className="lp-first-play-kicker">FIRST RUN</span>
                <strong>初めてなら、まずチュートリアル</strong>
                <p>入力・連鎖・TYPE BURSTを実際に触ってから、初級サバイバルへ進めます。</p>
              </div>
              <button type="button" onClick={() => onStart({ type: "tutorial" })}>
                チュートリアルを見る
              </button>
            </section>
          )}
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
        <GrowthDeck progress={progress} results={survivalResults} onOpen={onShowGrowth} />
        <TutorialDeck onOpen={() => onStart({ type: "tutorial" })} />
      </section>

      <DailyChallengeCard progress={dailyProgress} onStart={onStart} />

      <section className="lp-content" aria-labelledby="lp-content-title">
        <div className="lp-content-lead">
          <p className="lp-content-kicker">PLAY, MEASURE, IMPROVE</p>
          <h2 id="lp-content-title">遊んだ結果を、次の上達につなげる。</h2>
          <p>
            TYPE BURSTは、表示された日本語をローマ字で打つ速さだけを競うゲームではありません。
            どのブロックを先に消せば同じ色がつながるかを考え、タイピングと連鎖パズルを同時に楽しめます。
            プレイ後はKPM、正確率、最大連鎖、苦手キーを確認できるため、感覚だけで終わらず次の練習を決められます。
          </p>
        </div>

        <div className="lp-content-grid">
          <article>
            <span>01</span>
            <h3>初めてなら正確率を優先</h3>
            <p>
              まずは初級で、速さより打ち間違いを減らします。正確率95％以上を安定させてから中級へ進むと、
              Backspaceによる手戻りが減り、結果として速度も上がりやすくなります。
            </p>
            <a href="/guides/typing-beginner.html">初心者向け7ステップを見る</a>
          </article>
          <article>
            <span>02</span>
            <h3>速度が伸びないなら原因を分ける</h3>
            <p>
              KPMだけで判断せず、正確率と苦手キーを一緒に見ます。特定の文字で止まるならキーを限定して練習し、
              長い文章で落ちるなら短文から長文へ段階的に伸ばします。
            </p>
            <a href="/guides/typing-mistakes.html">ミスの原因を切り分ける</a>
          </article>
          <article>
            <span>03</span>
            <h3>測定条件をそろえて比べる</h3>
            <p>
              文章の長さや測定時間が違えば速度の数字も変わります。同じツール・同じ時間で複数回測り、
              最高値だけでなく正確率と中央値を見ると、本当の変化を判断しやすくなります。
            </p>
            <a href="/tools/typing-speed-test.html">60秒で速度を測定する</a>
          </article>
        </div>

        <div className="lp-practice-path" aria-labelledby="lp-practice-path-title">
          <div>
            <p className="lp-content-kicker">10 MINUTE ROUTINE</p>
            <h3 id="lp-practice-path-title">迷った日の10分メニュー</h3>
          </div>
          <ol>
            <li><strong>2分</strong><span>速度測定でKPMと正確率を確認</span></li>
            <li><strong>3分</strong><span>苦手キーまたはローマ字を限定して練習</span></li>
            <li><strong>5分</strong><span>正確率を保ったまま連鎖を狙う</span></li>
          </ol>
        </div>

        <div className="lp-metric-guide" aria-labelledby="lp-metric-guide-title">
          <h3 id="lp-metric-guide-title">結果画面で見る4つの指標</h3>
          <dl>
            <div><dt>KPM</dt><dd>1分あたりの打鍵数。測定時間と問題の難しさをそろえて比較します。</dd></div>
            <div><dt>正確率</dt><dd>速さの土台。低下した日は、速度を少し落としてミスの場所を確認します。</dd></div>
            <div><dt>最大連鎖</dt><dd>盤面を見て消す順番を選べたかの目安。速度とは別のゲーム攻略指標です。</dd></div>
            <div><dt>苦手キー</dt><dd>止まりやすい文字を特定し、全部を打ち直さず対象だけ短く反復します。</dd></div>
          </dl>
        </div>

        <div className="lp-content-links" aria-label="目的別の案内">
          <a href="/guides/how-to-type-faster.html">タイピングを速くする方法</a>
          <a href="/guides/typing-result-analysis.html">結果画面の数字の見方</a>
          <a href="/romaji">ローマ字入力を調べて試す</a>
          <a href="/about.html">ゲームのルールと全モード</a>
        </div>
      </section>

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
        <a href="/tools">無料タイピング測定</a>
        <a href="/guides/editorial-policy.html">記事制作方針</a>
        <a href="/contact.html">お問い合わせ</a>
        <a href="/press.html">報道関係者向け</a>
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
