import { useEffect } from "react";
import type { KeyStat, TypingAnalysis } from "@type-burst/game-core";
import { useFitToViewport } from "../hooks/useFitToViewport";

interface Props {
  analysis: TypingAnalysis;
  onBack: () => void;
}

/** JISキーボード配列に近い並び(段ごとに少しずつ右へずらす) */
const KEYBOARD_ROWS: readonly (readonly string[])[] = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

export function AnalysisScreen({ analysis, onBack }: Props): JSX.Element {
  const { ref, style } = useFitToViewport<HTMLDivElement>();

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onBack]);

  const statsByKey = new Map(analysis.keyStats.map((k) => [k.key, k]));
  const hasData = analysis.totalKeystrokes > 0;

  return (
    <div ref={ref} style={style} className="screen analysis">
      <h1 className="logo analysis-title">TYPING ANALYSIS</h1>

      {!hasData && <p className="ranking-status">記録がありません。プレイしてから確認してください。</p>}

      {hasData && (
        <>
          <div className="result-grid">
            <Item label="総打鍵数" value={String(analysis.totalKeystrokes)} />
            <Item label="正確率" value={`${(analysis.accuracy * 100).toFixed(1)}%`} />
            <Item label="ミス数" value={String(analysis.incorrectKeystrokes)} />
            <Item label="平均打鍵間隔" value={`${Math.round(analysis.averageIntervalMs)}ms`} />
          </div>

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
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <button className="btn-secondary" onClick={onBack} autoFocus>
        戻る <span className="btn-sub">Esc</span>
      </button>
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
