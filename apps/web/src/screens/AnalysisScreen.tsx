import { useEffect } from "react";
import type { FingerStat, KeyStat, TypingAnalysis } from "@type-burst/game-core";
import { titleProgressForScore, type LifetimeProgress } from "@type-burst/progression";
import type { StoredResult } from "../storage";

interface Props {
  /**
   * null = 直前のプレイ結果を経由せずに開いた場合(例: タイトル画面の「成長記録」から)。
   * このとき、その場のキー分析・ペース比較などプレイ単位のセクションは表示せず、
   * 長期的な成長グラフと生涯累計成績のみを表示する。
   */
  analysis: TypingAnalysis | null;
  /** 直近の記録(新しい順、現在のプレイを含む場合がある)。DUELでは空配列 */
  recentHistory: StoredResult[];
  progress: LifetimeProgress;
  onBack: () => void;
}

/** 成長グラフに表示する最大プレイ数(古すぎる記録まで詰め込むと見づらいため) */
const MAX_GROWTH_POINTS = 30;

/** JISキーボード配列に近い並び(段ごとに少しずつ右へずらす) */
const KEYBOARD_ROWS: readonly (readonly string[])[] = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

/** タッチタイピングの標準的な運指(表示用。集計は game-core 側で行う) */
const FINGER_LABEL_OF_KEY: Record<string, string> = {
  q: "左手小指",
  a: "左手小指",
  z: "左手小指",
  w: "左手薬指",
  s: "左手薬指",
  x: "左手薬指",
  e: "左手中指",
  d: "左手中指",
  c: "左手中指",
  r: "左手人差し指",
  f: "左手人差し指",
  v: "左手人差し指",
  t: "左手人差し指",
  g: "左手人差し指",
  b: "左手人差し指",
  y: "右手人差し指",
  h: "右手人差し指",
  n: "右手人差し指",
  u: "右手人差し指",
  j: "右手人差し指",
  m: "右手人差し指",
  i: "右手中指",
  k: "右手中指",
  o: "右手薬指",
  l: "右手薬指",
  p: "右手小指",
  "-": "右手小指",
};

const MIN_FINGER_ATTEMPTS = 3;
const MIN_SEGMENT_KEYSTROKES = 10;

/**
 * 成長記録・タイピング分析画面(D-090で全面改修)。
 *
 * 以前は同じ体裁の箱を縦に並べるだけで「情報の一覧」に見えていた。
 * この画面の主役は「自分が伸びていること」なので、
 *  1. 称号の進捗を見出しとして最初に置く
 *  2. 自己ベストを盤面の属性色を使った「記録」として大きく見せる
 *  3. グラフに開始時からの伸び(%)を必ず添え、上達を数字で言い切る
 * という順で組み直した。プレイ単位の詳細分析はその下に置く。
 * 集計ロジック・文言生成は一切変更していない(見せ方だけの変更)。
 */
export function AnalysisScreen({ analysis, recentHistory, progress, onBack }: Props): JSX.Element {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onBack]);

  const statsByKey = new Map(analysis?.keyStats.map((k) => [k.key, k]) ?? []);
  const hasPlayData = analysis !== null && analysis.totalKeystrokes > 0;

  const usedFingers =
    analysis?.fingerStats.filter((f) => f.correct + f.incorrect >= MIN_FINGER_ATTEMPTS) ?? [];
  const weakestFinger =
    [...usedFingers].filter((finger) => finger.missRate > 0).sort((a, b) => b.missRate - a.missRate)[0] ??
    null;
  const leftHand = analysis?.handStats.find((h) => h.hand === "left");
  const rightHand = analysis?.handStats.find((h) => h.hand === "right");

  const focus = analysis ? buildNextFocus(analysis, weakestFinger) : null;
  const paceInsight = analysis ? buildPaceInsight(analysis) : null;
  const trendInsight = buildTrendInsight(recentHistory);
  const historyScope = recentHistory.some((entry) => entry.mode === "daily")
    ? "デイリーチャレンジ"
    : "サバイバル";
  const titleProgress = titleProgressForScore(progress.totalScore);
  const played = progress.totalGames > 0;

  return (
    <div className="screen analysis an">
      <header className="an-head">
        <div>
          <span className="an-kicker">{analysis ? "TYPING ANALYSIS" : "GROWTH RECORD"}</span>
          <h1 className="an-title">{analysis ? "タイピング分析" : "成長記録"}</h1>
        </div>
        <button className="an-back" onClick={onBack}>
          戻る <span className="an-key">Esc</span>
        </button>
      </header>

      {/* ── 称号: この画面の見出しとして最初に置く ───────────────── */}
      <section className="an-rank" aria-label="称号">
        <div className="an-rank-top">
          <span className="an-rank-label">現在の称号</span>
          <strong className="an-rank-name">{titleProgress.current.label}</strong>
        </div>
        <div className="an-rank-track">
          <div
            className="an-rank-fill"
            style={{ width: `${Math.round(titleProgress.progressRatio * 100)}%` }}
          />
        </div>
        <div className="an-rank-foot">
          <span>累計 {progress.totalScore.toLocaleString()}</span>
          <span>
            {titleProgress.next
              ? `あと ${titleProgress.remainingToNext.toLocaleString()} で『${titleProgress.next.label}』`
              : "最高位に到達しました"}
          </span>
        </div>
      </section>

      {/* ── 自己ベスト: 盤面の属性色を使った「記録」として見せる ──── */}
      <section className="an-records" aria-label="自己ベスト">
        <Record tone="light" label="ベストスコア" value={progress.bestScore.toLocaleString()} />
        <Record tone="water" label="ベストKPM" value={String(Math.round(progress.bestKpm))} />
        <Record
          tone="wind"
          label="ベスト正確率"
          value={`${(progress.bestAccuracy * 100).toFixed(1)}%`}
        />
        <Record tone="fire" label="最大連鎖" value={String(progress.maxChainEver)} />
      </section>

      <section className="an-totals" aria-label="累計">
        <span>
          <b>{progress.totalGames}</b>
          <i>プレイ回数</i>
        </span>
        <span>
          <b>{progress.totalPhrases.toLocaleString()}</b>
          <i>打った文章</i>
        </span>
        <span>
          <b>{formatDuration(progress.totalPlaytimeMs)}</b>
          <i>総プレイ時間</i>
        </span>
        <span>
          <b>{progress.totalScore.toLocaleString()}</b>
          <i>累計スコア</i>
        </span>
      </section>

      {/* ── 成長グラフ: 「伸び」を数字で言い切る ──────────────── */}
      <section className="an-growth" aria-label="成長の推移">
        <div className="an-section-head">
          <h2>成長の推移</h2>
          {recentHistory.length >= 2 && (
            <span className="an-section-note">
              {historyScope}・直近{Math.min(recentHistory.length, MAX_GROWTH_POINTS)}戦・古い→新しい
            </span>
          )}
        </div>
        <p className="an-data-note">
          {historyScope}の記録だけを集計しています。デイリーとサバイバルのルール差で、成長の見え方が混ざらないようにしています。
        </p>

        {recentHistory.length >= 2 ? (
          <>
            <div className="an-charts">
              <GrowthChart
                label="スコア"
                values={chronological(recentHistory, (r) => r.score)}
                tone="light"
                format={(v) => Math.round(v).toLocaleString()}
              />
              <GrowthChart
                label="KPM"
                values={chronological(recentHistory, (r) => r.kpm)}
                tone="water"
                format={(v) => String(Math.round(v))}
              />
              <GrowthChart
                label="正確率"
                values={chronological(recentHistory, (r) => r.accuracy * 100)}
                tone="wind"
                format={(v) => `${v.toFixed(1)}%`}
                pointDelta
              />
            </div>
            {trendInsight && <p className="an-insight">{trendInsight}</p>}
          </>
        ) : (
          <p className="an-empty">
            {played
              ? "あと1回プレイすると、スコア・KPM・正確率の推移がここに描かれます。"
              : "プレイすると、ここに上達の記録が積み上がっていきます。"}
          </p>
        )}
      </section>

      {/* ── 今回のプレイの詳細分析 ────────────────────────── */}
      {!hasPlayData && (
        <p className="an-empty an-empty-note">
          プレイ後にこの画面を開くと、キーボードのヒートマップや前半・後半のペース比較など、
          その回だけの詳しい分析も表示されます。
        </p>
      )}

      {hasPlayData && analysis && (
        <>
          {focus && (
            <section className="an-focus">
              <span className="an-focus-badge">次に意識すること</span>
              <p>{focus}</p>
              {analysis.weakKeys[0] && (
                <a className="an-focus-link" href="/tools/weak-key-practice.html">
                  苦手キーを練習する
                </a>
              )}
            </section>
          )}

          <section className="an-detail" aria-label="今回のタイピング分析">
            <div className="an-section-head">
              <h2>今回のプレイ</h2>
              <span className="an-section-note">
                {analysis.totalKeystrokes}打鍵 ・ ミス{analysis.incorrectKeystrokes} ・ 平均
                {Math.round(analysis.averageIntervalMs)}ms
              </span>
            </div>

            <div className="an-grid">
              {/* キーボードのヒートマップ */}
              <div className="an-card an-card-wide">
                <div className="an-card-title">キー別の苦手度</div>
                <div className="an-keyboard">
                  {KEYBOARD_ROWS.map((row, i) => (
                    <div key={i} className="an-key-row" style={{ marginLeft: `${i * 17}px` }}>
                      {row.map((k) => (
                        <KeyTile
                          key={k}
                          keyChar={k}
                          stat={statsByKey.get(k)}
                          referenceMs={analysis.averageIntervalMs}
                        />
                      ))}
                    </div>
                  ))}
                  <div className="an-key-row">
                    <KeyTile
                      keyChar="-"
                      label="ー"
                      stat={statsByKey.get("-")}
                      referenceMs={analysis.averageIntervalMs}
                    />
                  </div>
                </div>
                <div className="an-legend">
                  <span>
                    <i style={{ background: heatColor(0) }} />
                    得意
                  </span>
                  <span>
                    <i style={{ background: heatColor(0.5) }} />
                    普通
                  </span>
                  <span>
                    <i style={{ background: heatColor(1) }} />
                    苦手
                  </span>
                  <span>
                    <i className="an-legend-none" />
                    未使用
                  </span>
                </div>
              </div>

              {/* 苦手キーを実際のキーキャップとして見せる */}
              {analysis.weakKeys.length > 0 && (
                <div className="an-card">
                  <div className="an-card-title">苦手なキー</div>
                  <div className="an-caps">
                    {analysis.weakKeys.slice(0, 6).map((k) => (
                      <div className="an-cap" key={k.key}>
                        <span className="an-cap-key" style={{ background: heatColor(k.missRate) }}>
                          {k.key === "-" ? "ー" : k.key.toUpperCase()}
                        </span>
                        <span className="an-cap-rate">{Math.round(k.missRate * 100)}%</span>
                        <span className="an-cap-sub">{k.correct + k.incorrect}打鍵</span>
                        <span className="an-cap-finger">{FINGER_LABEL_OF_KEY[k.key] ?? ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 前半 / 後半 */}
              <div className="an-card">
                <div className="an-card-title">前半 / 後半のペース</div>
                <div className="an-halves">
                  <PaceHalf label="前半" segment={analysis.firstHalf} />
                  <span className="an-halves-arrow" aria-hidden="true">
                    →
                  </span>
                  <PaceHalf label="後半" segment={analysis.secondHalf} />
                </div>
                {paceInsight && <p className="an-note">{paceInsight}</p>}
              </div>

              {/* 手・指 */}
              <div className="an-card an-card-wide">
                <div className="an-card-title">手・指ごとのミス率</div>
                <div className="an-hands">
                  <MissBar label="左手" missRate={leftHand?.missRate ?? 0} strong />
                  <MissBar label="右手" missRate={rightHand?.missRate ?? 0} strong />
                </div>
                {usedFingers.length > 0 && (
                  <div className="an-fingers">
                    {usedFingers
                      .slice()
                      .sort((a, b) => b.missRate - a.missRate)
                      .map((f) => (
                        <MissBar key={f.finger} label={f.label} missRate={f.missRate} />
                      ))}
                  </div>
                )}
                {weakestFinger && (
                  <p className="an-note">
                    特に{weakestFinger.label}のミスが多め(
                    {Math.round(weakestFinger.missRate * 100)}%)です。
                  </p>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** 自己ベスト1件。色は盤面の属性色に揃える(ホーム画面と同じ語彙) */
function Record({
  tone,
  label,
  value,
}: {
  tone: "fire" | "water" | "wind" | "light";
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className={`an-record an-tone-${tone}`}>
      <span className="an-record-label">{label}</span>
      <strong className="an-record-value">{value}</strong>
    </div>
  );
}

/** 苦手なキー・ペースの崩れ・指の偏りから、次に意識すべきことを1つ選んで文章化する */
function buildNextFocus(analysis: TypingAnalysis, weakestFinger: FingerStat | null): string | null {
  const topWeak = analysis.weakKeys[0];
  if (topWeak) {
    const finger = FINGER_LABEL_OF_KEY[topWeak.key];
    const keyLabel = topWeak.key === "-" ? "ー(長音)" : topWeak.key.toUpperCase();
    return `「${keyLabel}」のミスが目立ちます${finger ? `(${finger})` : ""}。この文字を含む単語を意識して練習してみましょう。`;
  }
  const { firstHalf, secondHalf } = analysis;
  const enoughData =
    firstHalf.keystrokes >= MIN_SEGMENT_KEYSTROKES && secondHalf.keystrokes >= MIN_SEGMENT_KEYSTROKES;
  if (enoughData && firstHalf.accuracy - secondHalf.accuracy >= 0.1) {
    return "後半になるとミスが増える傾向があります。中盤以降もペースを落とさず、集中力を保つことを意識しましょう。";
  }
  if (weakestFinger && weakestFinger.missRate >= 0.2) {
    return `${weakestFinger.label}のミスが多めです。その指を使うキーをゆっくり確実に押す練習をしてみましょう。`;
  }
  if (analysis.accuracy < 0.85) {
    return "全体的にミスが多めです。速さより正確さを優先して、一文字ずつ確実に打つことを意識しましょう。";
  }
  return null;
}

function buildPaceInsight(analysis: TypingAnalysis): string | null {
  const { firstHalf, secondHalf } = analysis;
  if (firstHalf.keystrokes < MIN_SEGMENT_KEYSTROKES || secondHalf.keystrokes < MIN_SEGMENT_KEYSTROKES) {
    return null;
  }
  const accDiff = secondHalf.accuracy - firstHalf.accuracy;
  if (accDiff <= -0.1) {
    return "後半に正確率が落ちています。疲れや焦りが出ているかもしれません。";
  }
  if (accDiff >= 0.1) {
    return "後半の方が正確率が高くなっています。調子が上がってきているタイプのようです。";
  }
  if (secondHalf.avgIntervalMs > 0 && firstHalf.avgIntervalMs > 0) {
    const paceDiff = secondHalf.avgIntervalMs - firstHalf.avgIntervalMs;
    if (paceDiff >= 30) return "後半になるにつれ打鍵が遅くなっています。";
    if (paceDiff <= -30) return "後半になるにつれ打鍵が速くなっています。";
  }
  return "前半・後半で大きな崩れはなく、安定しています。";
}

function buildTrendInsight(recentHistory: StoredResult[]): string | null {
  if (recentHistory.length < 2) return null;
  const recent = recentHistory.slice(0, 5);
  const latest = recent[0]!.accuracy;
  const oldest = recent[recent.length - 1]!.accuracy;
  const diff = latest - oldest;
  if (diff >= 0.05) return "直近の記録と比べて正確率が上がってきています。";
  if (diff <= -0.05) return "直近の記録と比べて正確率がやや下がっています。";
  return "直近の記録と比べて正確率は安定しています。";
}

/**
 * recentHistory(新しい順)から、直近 MAX_GROWTH_POINTS 件を古い→新しい順に並べ替え、
 * 指定した数値を取り出す(成長グラフは時系列で左→右に読めるようにするため)。
 */
function chronological(recentHistory: StoredResult[], pick: (r: StoredResult) => number): number[] {
  return recentHistory
    .slice(0, MAX_GROWTH_POINTS)
    .map(pick)
    .reverse();
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}時間${minutes}分`;
  return `${minutes}分`;
}

const CHART_W = 320;
const CHART_H = 84;
const CHART_PAD = 8;

/**
 * 成長グラフ(D-090で強化)。折れ線だけだった従来版に対し、
 * 面の塗り・最高記録の基準線・最新点の強調・そして「最初と比べてどれだけ
 * 伸びたか」のバッジを加えた。上達を数字で言い切ることがこの画面の主目的。
 */
function GrowthChart({
  label,
  values,
  tone,
  format,
  pointDelta = false,
}: {
  label: string;
  values: number[];
  tone: "fire" | "water" | "wind" | "light";
  format: (v: number) => string;
  /** true なら伸びを「ポイント差」で示す(正確率のように単位が%のもの) */
  pointDelta?: boolean;
}): JSX.Element | null {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = CHART_W - CHART_PAD * 2;
  const innerH = CHART_H - CHART_PAD * 2;
  const points = values.map((v, i) => ({
    x: CHART_PAD + (innerW * i) / (values.length - 1),
    y: CHART_PAD + innerH * (1 - (v - min) / span),
  }));
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${CHART_PAD},${CHART_H} ${line} ${CHART_W - CHART_PAD},${CHART_H}`;
  const last = points[points.length - 1]!;

  const first = values[0]!;
  const current = values[values.length - 1]!;
  const delta = current - first;
  const deltaText = pointDelta
    ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pt`
    : first > 0
      ? `${delta >= 0 ? "+" : ""}${Math.round((delta / first) * 100)}%`
      : null;
  const deltaDir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";

  return (
    <figure className={`an-chart an-tone-${tone}`}>
      <figcaption className="an-chart-head">
        <span className="an-chart-label">{label}</span>
        {deltaText && (
          <span className={`an-delta an-delta-${deltaDir}`}>
            {deltaDir === "up" ? "▲" : deltaDir === "down" ? "▼" : "－"} {deltaText}
          </span>
        )}
      </figcaption>

      <div className="an-chart-now">
        <strong>{format(current)}</strong>
        <span>最高 {format(max)}</span>
      </div>

      <svg
        className="an-chart-svg"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}の推移。開始${format(first)}、直近${format(current)}、最高${format(max)}`}
      >
        {/* 最高記録の基準線 */}
        <line
          className="an-chart-best"
          x1={CHART_PAD}
          y1={CHART_PAD}
          x2={CHART_W - CHART_PAD}
          y2={CHART_PAD}
        />
        <polygon className="an-chart-area" points={area} />
        <polyline className="an-chart-line" points={line} />
        <circle className="an-chart-dot" cx={last.x} cy={last.y} r={3.5} />
      </svg>
    </figure>
  );
}

function PaceHalf({
  label,
  segment,
}: {
  label: string;
  segment: TypingAnalysis["firstHalf"];
}): JSX.Element {
  return (
    <div className="an-half">
      <span className="an-half-label">{label}</span>
      <strong className="an-half-value">{(segment.accuracy * 100).toFixed(0)}%</strong>
      <span className="an-half-sub">
        {segment.keystrokes}打鍵 ・ {Math.round(segment.avgIntervalMs)}ms
      </span>
    </div>
  );
}

/** ミス率の横棒。手(strong)は指より一段大きく見せる */
function MissBar({
  label,
  missRate,
  strong = false,
}: {
  label: string;
  missRate: number;
  strong?: boolean;
}): JSX.Element {
  return (
    <div className={strong ? "an-bar an-bar-strong" : "an-bar"}>
      <span className="an-bar-label">{label}</span>
      <span className="an-bar-track">
        <span
          className="an-bar-fill"
          style={{ width: `${Math.round(missRate * 100)}%`, background: heatColor(missRate) }}
        />
      </span>
      <span className="an-bar-rate">{Math.round(missRate * 100)}%</span>
    </div>
  );
}

function KeyTile({
  keyChar,
  stat,
  label,
  referenceMs,
}: {
  keyChar: string;
  stat: KeyStat | undefined;
  label?: string;
  referenceMs: number;
}): JSX.Element {
  const attempts = stat ? stat.correct + stat.incorrect : 0;
  if (attempts === 0) {
    return (
      <div
        className="an-key an-key-none"
        title="未使用"
        role="img"
        aria-label={`${label ?? keyChar.toUpperCase()}、未使用`}
      >
        {label ?? keyChar.toUpperCase()}
      </div>
    );
  }
  const heat = troubleScore(stat!, referenceMs);
  return (
    <div
      className="an-key"
      style={{ background: heatColor(heat), color: "#10131f" }}
      title={`${attempts}回・ミス率${Math.round(stat!.missRate * 100)}%・平均${Math.round(stat!.avgIntervalMs)}ms`}
      role="img"
      aria-label={`${label ?? keyChar.toUpperCase()}、${attempts}回、ミス率${Math.round(stat!.missRate * 100)}%、平均${Math.round(stat!.avgIntervalMs)}ミリ秒`}
    >
      {label ?? keyChar.toUpperCase()}
    </div>
  );
}

/** ミス率と打鍵の遅さを合成した「苦手度」0〜1 */
function troubleScore(stat: KeyStat, referenceMs: number): number {
  const slowness = referenceMs > 0 ? Math.min(1, stat.avgIntervalMs / (referenceMs * 2)) : 0;
  return Math.max(0, Math.min(1, stat.missRate * 0.7 + slowness * 0.3));
}

/** 0(得意・緑)→0.5(普通・黄)→1(苦手・赤) */
function heatColor(heat: number): string {
  const h = Math.max(0, Math.min(1, heat));
  const good: [number, number, number] = [142, 245, 201];
  const mid: [number, number, number] = [255, 215, 94];
  const bad: [number, number, number] = [255, 107, 107];
  const [a, b, t] = h < 0.5 ? [good, mid, h / 0.5] : [mid, bad, (h - 0.5) / 0.5];
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}
