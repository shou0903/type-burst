import { findGroup, Prng, type Block, type GameConfig, type PlayerCore } from "@type-burst/game-core";
import { TypingAutomaton } from "@type-burst/typing-engine";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

export interface AttractProfile {
  /** 1分あたりの打鍵数 */
  kpm: number;
  /** 1キーごとのミス率 */
  errorRate: number;
  thinkMsMin: number;
  thinkMsMax: number;
  /** ゲージ満タンから TYPE BURST 発動までの遅延 */
  burstDelayMs: number;
}

/**
 * モバイル・ランディングページの「見せる」デモ向け設定。実プレイの CPU 対戦
 * (D-014, packages/game-core/src/duel.ts)よりテンポよく連鎖・TYPE BURSTが
 * 見られるよう速めにしつつ、たまにミスも混ぜて機械的すぎる印象を避ける。
 */
export const DEFAULT_ATTRACT_PROFILE: AttractProfile = {
  kpm: 480,
  errorRate: 0.02,
  thinkMsMin: 120,
  thinkMsMax: 260,
  burstDelayMs: 450,
};

/**
 * モバイル・ランディングページの「アトラクトモード」用オートタイパー(D-057)。
 * packages/game-core/src/duel.ts の CpuDriver(CPU対戦の自動入力)をそのまま
 * 土台にした web 層専用の簡易版。game-core 自体は一切変更せず、公開API
 * (PlayerCore, findGroup, Prng)だけを使って実物の盤面を自動進行させる。
 * これにより「本物のゲームが遊んでいるところ」をそのまま見せられる一方、
 * game-core の決定論(Seed駆動・Math.random不使用)は完全に維持される。
 */
export class AttractDemoDriver {
  private keyTimerMs: number;
  private plan: { targetId: number; keys: string; index: number } | null = null;
  private burstTimerMs: number | null = null;

  constructor(
    private readonly core: PlayerCore,
    private readonly rng: Prng,
    private readonly config: GameConfig,
    private readonly profile: AttractProfile = DEFAULT_ATTRACT_PROFILE,
  ) {
    this.keyTimerMs = this.thinkDelay();
  }

  private keyInterval(): number {
    const base = 60000 / this.profile.kpm;
    return base * (0.8 + this.rng.next() * 0.4);
  }

  private thinkDelay(): number {
    return (
      this.profile.thinkMsMin + this.rng.next() * (this.profile.thinkMsMax - this.profile.thinkMsMin)
    );
  }

  advance(deltaMs: number): void {
    if (this.core.frozen || this.core.toppedOut) return;

    // 必殺技: ゲージ満タンから一定時間後に発動(CpuDriverと同じ挙動)
    if (this.core.burstReady) {
      if (this.burstTimerMs === null) {
        this.burstTimerMs = this.profile.burstDelayMs;
      } else {
        this.burstTimerMs -= deltaMs;
        if (this.burstTimerMs <= 0 && !this.core.isResolving) {
          this.core.triggerBurst();
          this.burstTimerMs = null;
          this.plan = null;
          return;
        }
      }
    } else {
      this.burstTimerMs = null;
    }

    if (this.core.isResolving) return; // 連鎖演出中は待つ

    this.keyTimerMs -= deltaMs;
    let guard = 0;
    while (this.keyTimerMs <= 0 && guard < 20 && !this.core.isResolving && !this.core.frozen) {
      this.act();
      this.keyTimerMs += this.keyInterval();
      guard += 1;
    }
  }

  private act(): void {
    const blocks = this.core.getBlocksReadonly();
    if (blocks.length === 0) return;

    if (this.plan) {
      const target = blocks.find((b) => b.id === this.plan!.targetId);
      if (!target || this.plan.index >= this.plan.keys.length) {
        this.plan = null;
      }
    }

    if (!this.plan) {
      this.plan = this.pickPlan(blocks);
      this.keyTimerMs += this.thinkDelay();
      if (!this.plan) return;
    }

    // ミス(誤キー)を稀に混ぜる
    if (this.rng.next() < this.profile.errorRate) {
      const wrong = LETTERS.charAt(this.rng.int(LETTERS.length));
      this.core.feedKey(wrong);
      return;
    }

    const key = this.plan.keys.charAt(this.plan.index);
    this.plan.index += 1;
    this.core.feedKey(key);
    if (this.plan.index >= this.plan.keys.length) {
      this.plan = null;
    }
  }

  /** グループが大きいブロック・特殊ブロックを優先して狙う(CpuDriver.pickPlanと同じ方針) */
  private pickPlan(
    blocks: readonly Block[],
  ): { targetId: number; keys: string; index: number } | null {
    const { columns, visibleRows } = this.config;
    let best: Block | null = null;
    let bestValue = -1;
    for (const block of blocks) {
      let value: number;
      if (block.kind === "bomb") value = 6;
      else if (block.kind === "prism") value = 7;
      else if (block.kind === "garbage") value = 1.5;
      else {
        const group = findGroup(blocks, block, columns, visibleRows + 2);
        value = group.length >= this.config.chain.directClearMin ? group.length : 1;
      }
      value += (10 - Math.min(10, block.readingKana.length)) * 0.05;
      value += this.rng.next() * 0.5;
      if (value > bestValue) {
        bestValue = value;
        best = block;
      }
    }
    if (!best) return null;
    const keys = new TypingAutomaton(best.readingKana).getCanonicalRomaji();
    return { targetId: best.id, keys, index: 0 };
  }
}
