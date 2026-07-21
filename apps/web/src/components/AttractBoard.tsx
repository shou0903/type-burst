import { useEffect, useRef } from "react";
import { DEFAULT_CONFIG, PlayerCore, Prng } from "@type-burst/game-core";
import { GARBAGE_PHRASES, PHRASES } from "@type-burst/phrase-content";
import { AttractDemoDriver } from "../game/attractDemoDriver";
import { ATTRACT_RENDERER_OPTIONS, BoardRenderer, type FrameMeta } from "../render/BoardRenderer";

interface Props {
  /** true の場合はループアニメを一切動かさず、初期盤面を1枚だけ静止画として描く */
  reducedMotion: boolean;
}

/** アトラクトモード用の固定シード(D-057)。乱数選択は行わず、この配列を順番に巡回する
 * ことで game-core の決定論(Seed駆動)をそのまま維持する。 */
const SEEDS = ["attract-demo-a", "attract-demo-b", "attract-demo-c", "attract-demo-d"];

const STATIC_META: FrameMeta = {
  phase: "playing",
  countdownMsLeft: 0,
  // GO! の一瞬だけの演出をスキップするため十分大きい値にしておく
  elapsedMs: 99_999,
  endText: null,
};

const MAX_FRAME_MS = 1000 / 30; // 低スペック端末向けに描画負荷の上限を設ける

function createRound(seedIndex: number): { core: PlayerCore; driver: AttractDemoDriver } {
  const seed = SEEDS[seedIndex % SEEDS.length]!;
  const core = new PlayerCore(seed, PHRASES, GARBAGE_PHRASES, DEFAULT_CONFIG, DEFAULT_CONFIG.survivalRise);
  const driver = new AttractDemoDriver(core, new Prng(`${seed}:attract-driver`), DEFAULT_CONFIG);
  return { core, driver };
}

/**
 * モバイル・ランディングページ(D-057)専用: 実際のゲームエンジン
 * (packages/game-core の PlayerCore)をそのまま「自動プレイ」させて描画する
 * 無音・ループのデモ盤面。プレイ不可(タップでは操作できない)、見せるだけの用途。
 */
export function AttractBoard({ reducedMotion }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new BoardRenderer(canvas, ATTRACT_RENDERER_OPTIONS);
    renderer.reducedMotion = reducedMotion;

    if (reducedMotion) {
      // prefers-reduced-motion: 初期盤面を1枚だけ描き、以降は一切更新しない
      // (仕様書§20のアニメーション削減方針、D-023を踏襲)
      const { core } = createRound(0);
      renderer.draw(core.getSnapshot(), STATIC_META, 16);
      return;
    }

    let seedIndex = 0;
    let round = createRound(seedIndex);
    let rafId = 0;
    let last = performance.now();

    const step = (now: number): void => {
      rafId = requestAnimationFrame(step);
      const dt = Math.min(100, Math.max(0, now - last));
      last = now;
      if (dt < MAX_FRAME_MS) return; // 低スペック端末向けに描画頻度を間引く(概ね30fps上限)

      round.driver.advance(dt);
      round.core.advance(dt);
      for (const event of round.core.drainEvents()) renderer.onEvent(event);

      if (round.core.toppedOut) {
        // ループのため、あふれたら次のシードで最初から作り直す
        seedIndex += 1;
        round = createRound(seedIndex);
        renderer.clearEffects();
      }

      renderer.draw(round.core.getSnapshot(), STATIC_META, dt);
    };

    const handleVisibility = (): void => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      } else if (rafId === 0) {
        last = performance.now();
        rafId = requestAnimationFrame(step);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    if (!document.hidden) {
      rafId = requestAnimationFrame(step);
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (rafId !== 0) cancelAnimationFrame(rafId);
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className="attract-board-canvas" aria-hidden="true" />;
}
