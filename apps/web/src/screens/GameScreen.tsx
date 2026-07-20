import { useEffect, useRef, useState } from "react";
import { GameController, type AnySnapshot, type GameMode, type GameResult } from "../game/GameController";
import { SoundEngine } from "../audio/SoundEngine";
import { useFitToViewport } from "../hooks/useFitToViewport";

interface Props {
  mode: GameMode;
  sound: SoundEngine;
  reducedMotion: boolean;
  onFinish: (result: GameResult) => void;
  onQuit: () => void;
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function GameScreen({ mode, sound, reducedMotion, onFinish, onQuit }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<AnySnapshot | null>(null);
  const [imeWarning, setImeWarning] = useState(false);
  const { ref, style } = useFitToViewport<HTMLDivElement>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new GameController({
      canvas,
      cpuCanvas: cpuCanvasRef.current,
      mode,
      sound,
      reducedMotion,
      onSnapshot: setSnapshot,
      onFinish,
      onImeDetected: () => setImeWarning(true),
    });
    controller.start();
    return () => controller.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!imeWarning) return;
    const timer = window.setTimeout(() => setImeWarning(false), 4000);
    return () => window.clearTimeout(timer);
  }, [imeWarning]);

  const player = snapshot?.player ?? null;
  const gaugePercent = Math.round((player?.gauge ?? 0) * 100);

  return (
    <div ref={ref} style={style} className="screen game">
      {imeWarning && (
        <div className="ime-banner">日本語IMEがONのようです。半角英数モードに切り替えてください。</div>
      )}
      <div className="game-layout">
        <canvas ref={canvasRef} className="board-canvas" />
        <aside className="hud">
          <div className="hud-row">
            <div className="hud-mini">
              <div className="hud-label">
                TIME
                {snapshot?.mode === "survival" && (
                  <span className="level-chip">LV {snapshot.level}</span>
                )}
              </div>
              <div className="hud-time">{formatTime(snapshot?.elapsedMs ?? 0)}</div>
            </div>
            <div className="hud-mini">
              <div className="hud-label">SCORE</div>
              <div className="hud-score">{(player?.score ?? 0).toLocaleString()}</div>
            </div>
          </div>

          {player && player.perfectStreak >= 2 && (
            <div className="streak-badge">🔥 PERFECT ×{player.perfectStreak}</div>
          )}

          <div className="hud-block hud-typing">
            <div className="hud-label">INPUT</div>
            {player?.targetDisplayText ? (
              <>
                <div className="typing-target">{player.targetDisplayText}</div>
                <div className="typing-romaji">
                  <span className="typed">{player.typedRomaji}</span>
                  <span className="rest">{player.remainingRomaji}</span>
                </div>
              </>
            ) : player && player.typedRomaji.length > 0 ? (
              <>
                <div className="typing-target typing-hint">候補を絞り込み中…</div>
                <div className="typing-romaji">
                  <span className="typed">{player.typedRomaji}</span>
                </div>
              </>
            ) : (
              <div className="typing-target typing-hint">
                消したいブロックの文章を
                <br />
                ローマ字で入力
              </div>
            )}
          </div>

          <div className={player?.burstReady ? "hud-block burst-box burst-ready" : "hud-block burst-box"}>
            <div className="hud-label">
              BURST {player?.burstReady && <span className="burst-hint">Enter で発動!!</span>}
            </div>
            <div className="gauge-bar">
              <div
                className={player?.burstReady ? "gauge-fill gauge-full" : "gauge-fill"}
                style={{ width: `${gaugePercent}%` }}
              />
            </div>
          </div>

          <div className="hud-row">
            <div className="hud-mini">
              <div className="hud-label">CHAIN</div>
              <div className="hud-chain">
                {player && player.currentChain > 0 ? (
                  <span className="chain-now">{player.currentChain}</span>
                ) : (
                  <span className="chain-max">MAX {player?.maxChain ?? 0}</span>
                )}
              </div>
            </div>
            <div className="hud-mini">
              <div className="hud-label">KPM / ACC</div>
              <div className="hud-kpm">
                {Math.round(player?.kpm ?? 0)}{" "}
                <span className="hud-acc">{Math.round((player?.accuracy ?? 1) * 100)}%</span>
              </div>
            </div>
          </div>

          <div className="hud-block">
            <div className="hud-label">NEXT ROW</div>
            <div className="rise-bar">
              <div
                className={player?.riseWarningActive ? "rise-fill rise-fill-warning" : "rise-fill"}
                style={{ width: `${Math.round((player?.risePressure ?? 0) * 100)}%` }}
              />
            </div>
          </div>

          {mode.type === "duel" && (
            <div className="hud-block cpu-panel">
              <div className="hud-label">
                CPU{" "}
                {snapshot?.mode === "duel" && snapshot.cpu.incomingGarbage > 0 && (
                  <span className="cpu-incoming">▼{snapshot.cpu.incomingGarbage}</span>
                )}
              </div>
              <canvas ref={cpuCanvasRef} className="cpu-canvas" />
              <div className="cpu-score">
                {snapshot?.mode === "duel" ? snapshot.cpu.score.toLocaleString() : 0}
              </div>
            </div>
          )}
          {snapshot?.mode === "duel" && player && player.incomingGarbage > 0 && (
            <div className="incoming-badge">妨害接近 ▼{player.incomingGarbage}</div>
          )}

          {player?.danger && <div className="danger-badge">DANGER!</div>}

          <div className="key-help">Enter: バースト / Esc・BS: 選択キャンセル</div>

          <button className="btn-quit" onClick={onQuit} tabIndex={-1}>
            やめる
          </button>
        </aside>
      </div>
    </div>
  );
}
