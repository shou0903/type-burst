import { useEffect } from "react";
import type { FingerStat, KeyStat, TypingAnalysis } from "@type-burst/game-core";
import { titleProgressForScore, type LifetimeProgress } from "@type-burst/progression";
import { useFitToViewport } from "../hooks/useFitToViewport";
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

export function AnalysisScreen({ analysis, recentHistory, progress, onBack }: Props): JSX.Element {
  const { ref, style } = useFitToViewport<HTMLDivElement>();

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
  const weakestFinger = [...usedFingers].sort((a, b) => b.missRate - a.missRate)[0] ?? null;
  const leftHand = analysis?.handStats.find((h) => h.hand === "left");
  const rightHand = analysis?.handStats.find((h) => h.hand === "right");

  const focus = analysis ? buildNextFocus(analysis, weakestFinger) : null;
  const paceInsight = analysis ? buildPaceInsight(analysis) : null;
  const trendInsight = buildTrendInsight(recentHistory);
  const titleProgress = titleProgressForScore(progress.totalScore);

  return (
    <div ref={ref} style={style} className="screen analysis">
      <h1 className="logo analysis-title">{analysis ? "TYPING ANALYSIS" : "成長記録"}</h1>

      <div className="analysis-section growth-lifetime-section">
        <div className="analysis-section-title">称号 / 生涯累計成績</div>
        <div className="title-progress-bar title-progress-bar-wide">
          <div
            className="title-progress-fill"
            style={{ width: `${Math.round(titleProgress.progressRatio * 100)}%` }}
          />
        </div>
        <div className="title-badge-name">{titleProgress.current.label}</div>
        <div className="title-badge-next">
          {titleProgress.next
            ? `あと${titleProgress.remainingToNext.toLocaleString()}で『${titleProgress.next.label}』`
            : "最高位の称号に到達しました!"}
        </div>
        <div className="result-grid lifetime-grid">
          <Item label="累計プレイ" value={`${progress.totalGames}回`} />
          <Item label="累計スコア" value={progress.totalScore.toLocaleString()} />
          <Item label="ベストスコア" value={progress.bestScore.toLocaleString()} />
          <Item label="ベストKPM" value={String(Math.round(progress.bestKpm))} />
          <Item label="ベスト正確率" value={`${(progress.bestAccuracy * 100).toFixed(1)}%`} />
          <Item label="最大連鎖" value={String(progress.maxChainEver)} />
          <Item label="総文章数" value={`${progress.totalPhrases}文`} />
          <Item label="総プレイ時間" value={formatDuration(progress.totalPlaytimeMs)} />
        </div>
      </div>

      {recentHistory.length >= 2 ? (
        <div className="analysis-section growth-chart-section">
          <div className="analysis-section-title">
            成長グラフ(直近{Math.min(recentHistory.length, MAX_GROWTH_POINTS)}件・古い→新しい)
          </div>
          <GrowthChart
            label="スコア"
            values={chronological(recentHistory, (r) => r.score)}
            color="#ffd75e"
            format={(v) => Math.round(v).toLocaleString()}
          />
          <GrowthChart
            label="KPM"
            values={chronological(recentHistory, (r) => r.kpm)}
            color="#6fc0ff"
            format={(v) => String(Math.round(v))}
          />
          <GrowthChart
            label="正確率"
            values={chronological(recentHistory, (r) => r.accuracy * 100)}
            color="#8ef5c9"
            format={(v) => `${v.toFixed(1)}%`}
          />
          {trendInsight && <p className="analysis-insight">{trendInsight}</p>}
        </div>
      ) : (
        <p className="ranking-status">
          プレイを重ねると、ここにスコア・KPM・正確率の成長グラフが表示されます。
        </p>
      )}

      {!hasPlayData && (
        <p className="ranking-status">
          プレイするとキーボードのヒートマップやペース比較など、より詳しい分析も表示されます。
        </p>
      )}

      {hasPlayData && analysis && (
        <>
          <div className="result-grid">
            <Item label="総打鍵数" value={String(analysis.totalKeystrokes)} />
            <Item label="正確率" value={`${(analysis.accuracy * 100).toFixed(1)}%`} />
            <Item label="ミス数" value={String(analysis.incorrectKeystrokes)} />
            <Item label="平均打鍵間隔" value={`${Math.round(analysis.averageIntervalMs)}ms`} />
          </div>

          {focus && (
            <div className="focus-box">
              <div className="focus-title">次に意識すること</div>
              <div className="focus-text">{focus}</div>
            </div>
          )}

          <div className="analysis-keyboard-wrap">
            <div className="analysis-keyboard">
              {KEYBOARD_ROWS.map((row, i) => (
                <div key={i} className="analysis-key-row" style={{ marginLeft: `${i * 18}px` }}>
                  {row.map((k) => (
                    <KeyTile key={k} keyChar={k} stat={statsByKey.get(k)} referenceMs={analysis.averageIntervalMs} />
                  ))}
                </div>
              ))}
              <div className="analysis-key-row">
                <KeyTile
                  keyChar="-"
                  label="ー"
                  stat={statsByKey.get("-")}
                  referenceMs={analysis.averageIntervalMs}
                />
              </div>
            </div>
            <div className="analysis-legend">
              <span className="legend-item">
                <span className="legend-swatch" style={{ background: heatColor(0) }} />
                得意
              </span>
              <span className="legend-item">
                <span className="legend-swatch" style={{ background: heatColor(0.5) }} />
                普通
              </span>
              <span className="legend-item">
                <span className="legend-swatch" style={{ background: heatColor(1) }} />
                苦手
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-none" />
                未使用
              </span>
            </div>
          </div>

          {analysis.weakKeys.length > 0 && (
            <div className="weak-keys-box">
              <div className="weak-keys-title">苦手なキー TOP{analysis.weakKeys.length}</div>
              <div className="weak-keys-list">
                {analysis.weakKeys.map((k) => (
                  <div key={k.key} className="weak-key-item">
                    <span className="weak-key-char">{k.key === "-" ? "ー" : k.key.toUpperCase()}</span>
                    <span className="weak-key-detail">
                      ミス率 {Math.round(k.missRate * 100)}% ・ 平均 {Math.round(k.avgIntervalMs)}ms
                      <br />
                      {FINGER_LABEL_OF_KEY[k.key] ?? ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="analysis-section">
            <div className="analysis-section-title">前半 / 後半のペース比較</div>
            <div className="pace-compare">
              <PaceCard label="前半" segment={analysis.firstHalf} />
              <PaceCard label="後半" segment={analysis.secondHalf} />
            </div>
            {paceInsight && <p className="analysis-insight">{paceInsight}</p>}
          </div>

          <div className="analysis-section">
            <div className="analysis-section-title">手・指ごとのミス率</div>
            <div className="hand-compare">
              <HandBar label="左手" stat={leftHand} />
              <HandBar label="右手" stat={rightHand} />
            </div>
            {usedFingers.length > 0 && (
              <div className="finger-list">
                {usedFingers
                  .slice()
                  .sort((a, b) => b.missRate - a.missRate)
                  .map((f) => (
                    <div key={f.finger} className="finger-item">
                      <span className="finger-label">{f.label}</span>
                      <span className="finger-bar-wrap">
                        <span
                          className="finger-bar"
                          style={{
                            width: `${Math.round(f.missRate * 100)}%`,
                            background: heatColor(f.missRate),
                          }}
                        />
                      </span>
                      <span className="finger-rate">{Math.round(f.missRate * 100)}%</span>
                    </div>
                  ))}
              </div>
            )}
            {weakestFinger && (
              <p className="analysis-insight">
                特に{weakestFinger.label}のミスが多め(ミス率{Math.round(weakestFinger.missRate * 100)}%)です。
              </p>
            )}
          </div>

        </>
      )}

      <button className="btn-secondary" onClick={onBack} autoFocus>
        戻る <span className="btn-sub">Esc</span>
      </button>
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

const GROWTH_CHART_WIDTH = 280;
const GROWTH_CHART_HEIGHT = 56;
const GROWTH_CHART_PAD = 6;

/** 値の配列から、シンプルな折れ線グラフ用のSVG座標点列を計算する */
function buildGrowthPoints(values: number[]): { x: number; y: number }[] {
  if (values.length === 0) return [];
  if (values.length === 1) {
    return [{ x: GROWTH_CHART_WIDTH / 2, y: GROWTH_CHART_HEIGHT / 2 }];
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = GROWTH_CHART_WIDTH - GROWTH_CHART_PAD * 2;
  const innerH = GROWTH_CHART_HEIGHT - GROWTH_CHART_PAD * 2;
  return values.map((v, i) => ({
    x: GROWTH_CHART_PAD + (innerW * i) / (values.length - 1),
    y: GROWTH_CHART_PAD + innerH * (1 - (v - min) / span),
  }));
}

/**
 * 長期的な成長を示すシンプルな折れ線グラフ(D-054, Feature 3)。
 * 既存の`trend-bars`(直近5件の棒グラフ)を置き換え、より多くの記録を
 * 時系列で見せる。外部ライブラリは使わず素のSVGで描画する。
 */
function GrowthChart({
  label,
  values,
  color,
  format,
}: {
  label: string;
  values: number[];
  color: string;
  format: (v: number) => string;
}): JSX.Element | null {
  if (values.length < 2) return null;
  const points = buildGrowthPoints(values);
  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const best = Math.max(...values);

  return (
    <div className="growth-chart">
      <div className="growth-chart-head">
        <span className="growth-chart-label">{label}</span>
        <span className="growth-chart-value">
          {format(last)}
          <span className="growth-chart-best">最高 {format(best)}</span>
        </span>
      </div>
      <svg
        className="growth-chart-svg"
        viewBox={`0 0 ${GROWTH_CHART_WIDTH} ${GROWTH_CHART_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}の推移。開始${format(first)}、直近${format(last)}`}
      >
        <polyline points={polyline} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 3 : 1.6} fill={color} />
        ))}
      </svg>
    </div>
  );
}

function PaceCard({ label, segment }: { label: string; segment: TypingAnalysis["firstHalf"] }): JSX.Element {
  return (
    <div className="pace-card">
      <div className="pace-card-label">{label}</div>
      <div className="pace-card-value">{(segment.accuracy * 100).toFixed(0)}%</div>
      <div className="pace-card-sub">
        {segment.keystrokes}打鍵 ・ 平均{Math.round(segment.avgIntervalMs)}ms
      </div>
    </div>
  );
}

function HandBar({
  label,
  stat,
}: {
  label: string;
  stat: { correct: number; incorrect: number; missRate: number } | undefined;
}): JSX.Element {
  const missRate = stat?.missRate ?? 0;
  const attempts = stat ? stat.correct + stat.incorrect : 0;
  return (
    <div className="hand-bar-item">
      <div className="hand-bar-label">{label}</div>
      <span className="finger-bar-wrap">
        <span
          className="finger-bar"
          style={{ width: `${Math.round(missRate * 100)}%`, background: heatColor(missRate) }}
        />
      </span>
      <div className="hand-bar-rate">{attempts === 0 ? "-" : `${Math.round(missRate * 100)}%`}</div>
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
      <div className="analysis-key analysis-key-none" title="未使用">
        {label ?? keyChar.toUpperCase()}
      </div>
    );
  }
  const heat = troubleScore(stat!, referenceMs);
  return (
    <div
      className="analysis-key"
      style={{ background: heatColor(heat), color: "#10131f" }}
      title={`${attempts}回・ミス率${Math.round(stat!.missRate * 100)}%・平均${Math.round(stat!.avgIntervalMs)}ms`}
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

function Item({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="result-item">
      <div className="result-label">{label}</div>
      <div className="result-value">{value}</div>
    </div>
  );
}
