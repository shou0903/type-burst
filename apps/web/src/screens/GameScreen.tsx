import { useEffect, useRef, useState } from "react";
import type { GameEvent } from "@type-burst/game-core";
import { GameController, type AnySnapshot, type GameMode, type GameResult } from "../game/GameController";
import { SoundEngine } from "../audio/SoundEngine";
import { useFitToViewport } from "../hooks/useFitToViewport";
import {
  createFocusProgress,
  focusGoalDefinition,
  focusProgressText,
  type FocusProgress,
} from "../focusContract";

interface Props {
  mode: GameMode;
  sound: SoundEngine;
  reducedMotion: boolean;
  highContrast: boolean;
  fontScale: number;
  /** 現行 survival-v2 の同難易度ベスト。ペース表示ではなく差分目標にだけ使う。 */
  survivalBestScore: number;
  tutorialCompletionStartsGame: boolean;
  onTutorialComplete: () => void;
  onFinish: (result: GameResult) => void;
  onQuit: () => void;
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * キー単位ではなく、意味のある節目だけをHUDへ知らせる。Canvasの大きな文字と
 * 同じ文言を連打せず、スクリーンリーダーにも「次の判断」を渡すための短い要約。
 */
function gameEventCue(event: GameEvent): string | null {
  switch (event.type) {
    case "burstTierChanged":
      return event.tier === "max"
        ? "MAX BURST 準備完了"
        : event.tier === "power"
          ? "POWER BURST 準備完了"
          : event.tier === "ready"
            ? "BURST 準備完了。Enterで発動"
            : null;
    case "burstFired":
      return event.tier === "max"
        ? `MAX BURST 発動。${event.rows}行を消去`
        : event.tier === "power"
          ? `POWER BURST 発動。${event.rows}行を消去`
          : `BURST 発動。${event.rows}行を消去`;
    case "chainFinished":
      return event.depth >= 2 ? `${event.depth} CHAIN 完了` : null;
    case "clutchClear":
      return `CLUTCH CLEAR！ ${event.depth}連鎖で危機を脱出`;
    case "feverStarted":
      return "FEVER 開始。連鎖をつなげよう";
    case "feverEnded":
      return "FEVER 終了";
    case "dangerChanged":
      return event.danger ? "DANGER！ 次の落下までに盤面を救おう" : "DANGER 脱出";
    case "garbageSent":
      return `妨害ブロックを${event.count}個送信`;
    case "garbageCancelled":
      return `妨害を${event.count}個相殺`;
    case "garbageLanded":
      return `妨害ブロック${event.count}個が着弾`;
    case "selectionCancelled":
      return "選択をキャンセル";
    case "allClear":
      return `ALL CLEAR！ +${event.bonus.toLocaleString()}`;
    case "levelUp":
      return `LEVEL ${event.level}`;
    default:
      return null;
  }
}

export function GameScreen({
  mode,
  sound,
  reducedMotion,
  highContrast,
  fontScale,
  survivalBestScore,
  tutorialCompletionStartsGame,
  onTutorialComplete,
  onFinish,
  onQuit,
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<GameController | null>(null);
  const tutorialNextRef = useRef<HTMLButtonElement>(null);
  const pauseResumeRef = useRef<HTMLButtonElement>(null);
  const quitCancelRef = useRef<HTMLButtonElement>(null);
  const gameOverlayRef = useRef<HTMLDivElement>(null);
  const tutorialFocusKeyRef = useRef<string | null>(null);
  const latestSnapshotRef = useRef<AnySnapshot | null>(null);
  const snapshotPublishedAtRef = useRef<number | null>(null);
  const snapshotPublishTimerRef = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<AnySnapshot | null>(null);
  const [imeWarning, setImeWarning] = useState(false);
  const [eventCue, setEventCue] = useState("");
  const [paused, setPaused] = useState(false);
  const [quitRequested, setQuitRequested] = useState(false);
  const [focusProgress, setFocusProgress] = useState<FocusProgress | null>(() =>
    mode.type === "survival"
      ? createFocusProgress(mode.focusGoal ?? "perfect-streak")
      : null,
  );
  const focusAchievedRef = useRef(false);
  const cueTimerRef = useRef<number | null>(null);
  const { ref, style } = useFitToViewport<HTMLDivElement>();

  const announceCue = (message: string): void => {
    setEventCue(message);
    if (cueTimerRef.current !== null) window.clearTimeout(cueTimerRef.current);
    cueTimerRef.current = window.setTimeout(() => {
      setEventCue("");
      cueTimerRef.current = null;
    }, 2600);
  };

  // Canvas描画は毎フレーム続ける一方、React HUDは最大でも約10fpsにまとめる。
  // 入力中の最新スナップショットはrefへ保持し、遅延通知が古い状態を公開しない。
  const publishSnapshot = (nextSnapshot: AnySnapshot): void => {
    latestSnapshotRef.current = nextSnapshot;
    const now = performance.now();
    const publishedAt = snapshotPublishedAtRef.current;
    if (publishedAt === null || now - publishedAt >= 100) {
      snapshotPublishedAtRef.current = now;
      setSnapshot(nextSnapshot);
      return;
    }
    if (snapshotPublishTimerRef.current !== null) return;
    snapshotPublishTimerRef.current = window.setTimeout(() => {
      snapshotPublishTimerRef.current = null;
      const latest = latestSnapshotRef.current;
      if (!latest) return;
      snapshotPublishedAtRef.current = performance.now();
      setSnapshot(latest);
    }, Math.max(0, 100 - (now - publishedAt)));
  };

  const requestQuit = (): void => {
    // 確認中に盤面やタイマーが進まないよう、終了確認へ入る時点で止める。
    controllerRef.current?.setPauseInputLocked(true);
    controllerRef.current?.pause();
    setQuitRequested(true);
  };

  const cancelQuit = (): void => {
    setQuitRequested(false);
    controllerRef.current?.setPauseInputLocked(false);
    controllerRef.current?.resume();
  };

  const confirmQuit = (): void => {
    controllerRef.current?.dispose();
    onQuit();
  };

  const resumeGame = (): void => {
    controllerRef.current?.resume();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new GameController({
      canvas,
      cpuCanvas: cpuCanvasRef.current,
      mode,
      sound,
      reducedMotion,
      highContrast,
      fontScale,
      onSnapshot: publishSnapshot,
      onPlayerEvent: (event) => {
        const message = gameEventCue(event);
        if (message) announceCue(message);
      },
      onFocusProgress: (progress) => {
        setFocusProgress(progress);
        if (progress.achieved && !focusAchievedRef.current) {
          focusAchievedRef.current = true;
          announceCue("FOCUS COMPLETE！ 今回の目標を達成");
        }
      },
      onPauseChange: setPaused,
      onQuitRequest: requestQuit,
      onFinish,
      onImeDetected: () => setImeWarning(true),
    });
    controllerRef.current = controller;
    controller.start();
    return () => {
      controllerRef.current = null;
      controller.dispose();
      if (cueTimerRef.current !== null) window.clearTimeout(cueTimerRef.current);
      if (snapshotPublishTimerRef.current !== null) {
        window.clearTimeout(snapshotPublishTimerRef.current);
        snapshotPublishTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!imeWarning) return;
    const timer = window.setTimeout(() => setImeWarning(false), 4000);
    return () => window.clearTimeout(timer);
  }, [imeWarning]);

  const tutorialStepIndex = snapshot?.mode === "tutorial" ? snapshot.stepIndex : null;
  const tutorialStepComplete = snapshot?.mode === "tutorial" ? snapshot.stepComplete : null;

  useEffect(() => {
    if (!paused || quitRequested) return;
    const frame = window.requestAnimationFrame(() => pauseResumeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [paused, quitRequested]);

  useEffect(() => {
    if (!quitRequested) return;
    const frame = window.requestAnimationFrame(() => quitCancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [quitRequested]);

  useEffect(() => {
    if (!paused && !quitRequested) return;
    const handleOverlayKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && quitRequested) {
        event.preventDefault();
        event.stopPropagation();
        cancelQuit();
        return;
      }
      if (event.key !== "Tab") return;
      const root = gameOverlayRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleOverlayKeyDown, true);
    return () => document.removeEventListener("keydown", handleOverlayKeyDown, true);
  }, [paused, quitRequested]);

  useEffect(() => {
    const tutorialSnapshot = snapshot?.mode === "tutorial" ? snapshot : null;
    if (!tutorialSnapshot) return;
    const focusKey = `${tutorialSnapshot.stepIndex}`;
    if (!tutorialSnapshot.stepComplete) {
      tutorialFocusKeyRef.current = null;
      return;
    }
    if (tutorialFocusKeyRef.current === focusKey || paused || quitRequested) return;
    tutorialFocusKeyRef.current = focusKey;
    const frame = window.requestAnimationFrame(() => tutorialNextRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [snapshot?.mode, tutorialStepIndex, tutorialStepComplete, paused, quitRequested]);

  const player = snapshot?.player ?? null;
  const gaugePercent = Math.round((player?.gauge ?? 0) * 100);
  const burstCharge = Math.max(0, Math.min(150, player?.burstCharge ?? 0));
  const overdrive = mode.type === "survival" && player?.burstOverchargeEnabled === true;
  const burstTier = player?.burstTier ?? "charging";
  const burstTierLabel =
    burstTier === "max" ? "MAX BURST" : burstTier === "power" ? "POWER BURST" : "BURST";
  const currentScore = player?.score ?? 0;
  const bestScore = Math.max(0, survivalBestScore);
  const bestProgress = bestScore > 0 ? Math.min(100, (currentScore / bestScore) * 100) : 0;
  const feverTarget = player?.feverTriggerChainDepth ?? 6;
  const feverSeconds = Math.ceil((player?.feverMsLeft ?? 0) / 1000);
  const feverDurationMs = Math.max(1, player?.feverDurationMs ?? 1);
  const feverWarning = Boolean(player?.feverActive && feverSeconds <= 3);
  const showFeverPrimer = mode.type === "survival";
  const candidateCount = player?.candidateBlockIds.length ?? 0;

  return (
    <div ref={ref} style={style} className="screen game">
      {imeWarning && (
        <div className="ime-banner">日本語IMEがONのようです。半角英数モードに切り替えてください。</div>
      )}
      {snapshot?.mode === "tutorial" && (
        <div className="tutorial-banner">
          <div className="tutorial-banner-head">
            <span className="tutorial-step-counter">
              {snapshot.stepIndex + 1} / {snapshot.totalSteps}
            </span>
            <span className="tutorial-step-title">{snapshot.stepTitle}</span>
          </div>
          <p className="tutorial-step-instruction">{snapshot.stepInstruction}</p>
          <div className="tutorial-banner-actions">
            {!snapshot.isLastStep && (
              <button className="btn-secondary tutorial-skip" onClick={requestQuit}>
                スキップ
              </button>
            )}
            <button
              ref={tutorialNextRef}
              className="btn-primary tutorial-next"
              disabled={!snapshot.stepComplete}
              onClick={() => {
                if (snapshot.isLastStep) {
                  onTutorialComplete();
                } else {
                  controllerRef.current?.advanceTutorialStep();
                }
              }}
            >
              <span>
                {snapshot.isLastStep
                  ? tutorialCompletionStartsGame
                    ? "初級サバイバルへ"
                    : "タイトルへ戻る"
                  : "次へ →"}
              </span>
              <kbd>Enter</kbd>
            </button>
          </div>
        </div>
      )}
      <div className="game-layout">
        <canvas
          ref={canvasRef}
          className="board-canvas"
          tabIndex={-1}
          onPointerDown={(event) => {
            // HUDボタンをTab操作した後でも、盤面をクリックすれば即座にゲーム入力へ戻れる。
            // tabIndex=-1なので通常のTab順序には盤面を増やさない。
            event.currentTarget.focus();
          }}
        />
        <aside className="hud">
          <div className="hud-row">
            <div className="hud-mini">
              <div className="hud-label">
                {mode.type === "daily" ? "TIME LEFT" : "TIME"}
                {snapshot?.mode === "survival" && (
                  <>
                    {" "}
                    <span className="level-chip">
                      {mode.type === "daily" ? "TODAY" : `LV ${snapshot.level}`}
                    </span>
                  </>
                )}
              </div>
              <div className="hud-time">
                {formatTime(
                  mode.type === "daily" && snapshot?.mode === "survival" && snapshot.timeLimitMs
                    ? Math.max(0, snapshot.timeLimitMs - snapshot.elapsedMs)
                    : snapshot?.elapsedMs ?? 0,
                )}
              </div>
            </div>
            <div className="hud-mini">
              <div className="hud-label">SCORE</div>
              <div className="hud-score">{(player?.score ?? 0).toLocaleString()}</div>
              {mode.type === "survival" && (
                <div className="personal-best-goal" aria-label="自己ベストへの進捗">
                  <span>
                    {bestScore > 0
                      ? currentScore >= bestScore
                        ? "自己ベスト更新ペース"
                        : `自己ベストまで ${(bestScore - currentScore).toLocaleString()}点`
                      : "まずは自己ベストを作ろう"}
                  </span>
                  {bestScore > 0 && (
                    <span className="personal-best-track" aria-hidden="true">
                      <span style={{ width: `${bestProgress}%` }} />
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div
            className={`streak-badge badge-reserved${
              player && player.perfectStreak >= 2 ? "" : " badge-hidden"
            }`}
          >
            🔥 PERFECT ×{player?.perfectStreak ?? 0}
          </div>

          <div
            className={`fever-badge badge-reserved${
              player?.feverActive
                ? " fever-active"
                : showFeverPrimer
                  ? " fever-inactive"
                  : " fever-inactive badge-hidden"
            }${feverWarning ? " fever-warning" : ""}`}
            aria-label={
              player?.feverActive
                ? `フィーバー中。スコア${player.feverScoreMultiplier}倍。残り${feverSeconds}秒`
                : showFeverPrimer
                  ? `フィーバーは${feverTarget}連鎖で発動`
                  : undefined
            }
          >
            {player?.feverActive ? (
              <>
                <span>🔥 FEVER TIME! SCORE ×{player.feverScoreMultiplier}</span>
                <span className="fever-countdown">
                  {feverWarning ? "急げ！" : "残り"} {feverSeconds}s
                </span>
                <span className="fever-track" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (player.feverMsLeft / feverDurationMs) * 100)}%` }} />
                </span>
              </>
            ) : (
              showFeverPrimer ? <span>FEVER: {feverTarget}連鎖で発動</span> : null
            )}
          </div>

          {focusProgress && (
            <section
              className={`focus-hud${focusProgress.achieved ? " focus-hud-achieved" : ""}`}
              aria-label={`今回の目標 ${focusGoalDefinition(focusProgress.goal).title}。${focusProgressText(focusProgress)}`}
            >
              <div className="focus-hud-head">
                <span>FOCUS</span>
                <strong>{focusProgress.achieved ? "✓ COMPLETE" : focusProgressText(focusProgress)}</strong>
              </div>
              <p>{focusGoalDefinition(focusProgress.goal).title}</p>
              <span className="focus-hud-track" aria-hidden="true">
                <span style={{ width: `${Math.round(focusProgress.ratio * 100)}%` }} />
              </span>
            </section>
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
                <div className="typing-target typing-hint">
                  候補{candidateCount}件・入力は保持中
                </div>
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

          {mode.type === "survival" && player && player.chainPreviews.length > 0 && (
            <div className="chain-vision-hint" aria-label="連鎖候補の表示">
              <span className="chain-vision-mark" aria-hidden="true">›</span>
              <span>連鎖候補を表示中</span>
              <small>数字が大きいほど連鎖予測が長い</small>
            </div>
          )}

          {overdrive ? (
            <div
              className={`hud-block burst-box burst-overdrive burst-tier-${burstTier}`}
              aria-label={`バーストゲージ ${Math.round(burstCharge)} / 150。現在${burstTierLabel}`}
            >
              <div className="hud-label">
                <span>BURST OVERDRIVE</span>
                <strong className="burst-tier-label">{burstTierLabel}</strong>
              </div>
              <div className="overdrive-track" aria-hidden="true">
                <div className="overdrive-fill" style={{ width: `${(burstCharge / 150) * 100}%` }} />
                <i className="overdrive-marker overdrive-marker-ready" />
                <i className="overdrive-marker overdrive-marker-power" />
                <i className="overdrive-marker overdrive-marker-max" />
              </div>
              <div className="overdrive-scale" aria-hidden="true">
                <span>0</span>
                <span>READY 100</span>
                <span>POWER 125</span>
                <span>MAX 150</span>
              </div>
              <div className="burst-hint burst-overdrive-hint">
                {burstTier === "max"
                  ? "MAX BURST! Enterで5行を消去"
                  : burstTier === "power"
                    ? "POWER BURST! Enterで4行を消去"
                    : burstTier === "ready"
                      ? "Enterで安全に発動／溜めるとPOWERへ"
                      : `READYまであと${Math.max(0, Math.ceil(100 - burstCharge))}`}
              </div>
            </div>
          ) : (
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
          )}

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

          {mode.type === "daily" ? (
            <div className="hud-block daily-board-rule">
              <div className="hud-label">FULL BOARD RUSH</div>
              <strong>全消しで即リフィル</strong>
              <span>BOMB・PRISM・BURST</span>
            </div>
          ) : mode.type !== "tutorial" && (
            <div className="hud-block">
              <div className="hud-label">NEXT ROW</div>
              <div className="rise-bar">
                <div
                  className={player?.riseWarningActive ? "rise-fill rise-fill-warning" : "rise-fill"}
                  style={{ width: `${Math.round((player?.risePressure ?? 0) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {mode.type === "duel" && (
            <div className="hud-block cpu-panel">
              <div className="hud-label">
                CPU{" "}
                <span
                  className={`cpu-incoming badge-reserved${
                    snapshot?.mode === "duel" && snapshot.cpu.incomingGarbage > 0 ? "" : " badge-hidden"
                  }`}
                >
                  ▼{snapshot?.mode === "duel" ? snapshot.cpu.incomingGarbage : 0}
                </span>
              </div>
              <canvas ref={cpuCanvasRef} className="cpu-canvas" />
              <div className="cpu-score">
                {snapshot?.mode === "duel" ? snapshot.cpu.score.toLocaleString() : 0}
              </div>
            </div>
          )}
          {mode.type === "duel" && (
            <div
              className={`incoming-badge badge-reserved${
                snapshot?.mode === "duel" && player && player.incomingGarbage > 0 ? "" : " badge-hidden"
              }`}
            >
              妨害接近 ▼{snapshot?.mode === "duel" && player ? player.incomingGarbage : 0}
            </div>
          )}

          <div
            className={`game-event-cue${eventCue ? "" : " game-event-cue-empty"}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {eventCue}
          </div>

          <div
            className={`danger-badge badge-reserved${player?.danger ? "" : " badge-hidden"}`}
            role="status"
            // 秒数は毎フレーム変わるため、音とイベント通知をまとめた上の
            // game-event-cueだけを読み上げ対象にする。
            aria-live="off"
            aria-atomic="true"
            aria-label={
              player?.danger
                ? `DANGER。次の落下まで${Math.max(0, player.riseMsLeft / 1000).toFixed(1)}秒`
                : undefined
            }
          >
            <strong>DANGER!</strong>
            <span className="danger-countdown">
              次の落下まで {player ? Math.max(0, player.riseMsLeft / 1000).toFixed(1) : "0.0"}秒
            </span>
          </div>

          <div className="key-help">
            {snapshot?.mode === "tutorial"
              ? "Enter: 次へ / Esc: 終了確認 / P: 一時停止"
              : "Enter: バースト / P: 一時停止 / Esc・BS: 選択キャンセル"}
          </div>

          <button className="btn-pause" type="button" aria-pressed={paused} onClick={paused ? resumeGame : () => controllerRef.current?.pause()}>
            {paused ? "再開" : "一時停止"} <kbd>P</kbd>
          </button>
          <button className="btn-quit" type="button" onClick={requestQuit}>
            やめる
          </button>
        </aside>
      </div>

      {paused && !quitRequested && (
        <div ref={gameOverlayRef} className="game-overlay-backdrop">
          <section
            className="game-overlay-panel game-paused-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-paused-title"
          >
            <p className="game-overlay-kicker">GAME PAUSED</p>
            <h2 id="game-paused-title">一時停止中</h2>
            <p>盤面・時間・スコアは止まっています。準備ができたら続けてください。</p>
            <div className="game-overlay-actions">
              <button ref={pauseResumeRef} className="btn-primary" type="button" onClick={resumeGame}>
                続ける <kbd>P</kbd>
              </button>
              <button className="btn-secondary" type="button" onClick={requestQuit}>
                タイトルへ戻る
              </button>
            </div>
          </section>
        </div>
      )}

      {quitRequested && (
        <div ref={gameOverlayRef} className="game-overlay-backdrop">
          <section
            className="game-overlay-panel game-quit-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-quit-title"
          >
            <p className="game-overlay-kicker">LEAVE GAME?</p>
            <h2 id="game-quit-title">ゲームを終了しますか？</h2>
            <p>このプレイの途中経過は結果として保存されません。</p>
            <div className="game-overlay-actions">
              <button ref={quitCancelRef} className="btn-primary" type="button" onClick={cancelQuit}>
                続ける
              </button>
              <button className="btn-secondary" type="button" onClick={confirmQuit}>
                タイトルへ
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
