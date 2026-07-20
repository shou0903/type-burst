import { TypingAutomaton } from "@type-burst/typing-engine";
import type { JapanesePhrase } from "@type-burst/phrase-content";
import { findGroup } from "./board";
import { DEFAULT_CONFIG, type CpuProfile, type GameConfig } from "./config";
import { PlayerCore } from "./player";
import { Prng } from "./prng";
import type {
  Block,
  CpuDifficulty,
  DuelSnapshot,
  DuelSummary,
  GameEvent,
  GamePhase,
  TaggedEvent,
} from "./types";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * CPU プレイヤー。実際にキーを1打ずつ入力する(結果の直接書き換えはしない)。
 * 乱数は専用 Seed から取るため試合全体が決定論的。
 */
class CpuDriver {
  private keyTimerMs: number;
  private plan: { targetId: number; keys: string; index: number } | null = null;
  private burstTimerMs: number | null = null;

  constructor(
    private readonly core: PlayerCore,
    private readonly rng: Prng,
    private readonly profile: CpuProfile,
    private readonly config: GameConfig,
  ) {
    this.keyTimerMs = this.thinkDelay();
  }

  private keyInterval(): number {
    const base = 60000 / this.profile.kpm;
    return base * (0.8 + this.rng.next() * 0.4);
  }

  private thinkDelay(): number {
    return (
      this.profile.thinkMsMin +
      this.rng.next() * (this.profile.thinkMsMax - this.profile.thinkMsMin)
    );
  }

  advance(deltaMs: number): void {
    if (this.core.frozen || this.core.toppedOut) return;

    // 必殺技: ゲージ満タンから一定時間後に発動
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

    if (this.core.isResolving) return; // 連鎖中は待つ(人間と同じ制約)

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

    // ミス(誤キー)
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

  /** グループが大きいブロック・特殊ブロックを優先して狙う */
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
      // 短い文章を少しだけ好む + わずかな揺らぎ
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

/**
 * CPU との 1対1。時間制限なし。相手の盤面をあふれさせたら勝ち。
 */
export class DuelGame {
  readonly seed: string;
  readonly difficulty: CpuDifficulty;
  private readonly config: GameConfig;
  private readonly player: PlayerCore;
  private readonly cpu: PlayerCore;
  private readonly cpuDriver: CpuDriver;

  private phase: GamePhase = "countdown";
  private countdownMsLeft: number;
  private lastCountdownSecond: number;
  private elapsedMs = 0;
  private winner: "player" | "cpu" | null = null;
  private events: TaggedEvent[] = [];

  constructor(
    seed: string,
    phrases: readonly JapanesePhrase[],
    garbagePhrases: readonly JapanesePhrase[],
    difficulty: CpuDifficulty,
    config: GameConfig = DEFAULT_CONFIG,
  ) {
    this.seed = seed;
    this.difficulty = difficulty;
    this.config = config;
    this.countdownMsLeft = config.countdownMs;
    this.lastCountdownSecond = Math.ceil(config.countdownMs / 1000);
    this.player = new PlayerCore(`${seed}:p1`, phrases, garbagePhrases, config, config.duelRise);
    this.cpu = new PlayerCore(`${seed}:p2`, phrases, garbagePhrases, config, config.duelRise);
    this.cpuDriver = new CpuDriver(this.cpu, new Prng(`${seed}:cpu`), config.cpu[difficulty], config);
  }

  advance(deltaMs: number): TaggedEvent[] {
    if (deltaMs < 0) deltaMs = 0;
    if (this.phase === "countdown") {
      this.countdownMsLeft -= deltaMs;
      const second = Math.max(0, Math.ceil(this.countdownMsLeft / 1000));
      if (second !== this.lastCountdownSecond) {
        this.lastCountdownSecond = second;
        if (second > 0) {
          this.events.push({ side: "player", event: { type: "countdownTick", secondsLeft: second } });
        }
      }
      if (this.countdownMsLeft <= 0) {
        this.phase = "playing";
        this.events.push({ side: "player", event: { type: "started" } });
        const leftover = -this.countdownMsLeft;
        this.countdownMsLeft = 0;
        if (leftover > 0) this.advancePlaying(leftover);
      }
    } else if (this.phase === "playing") {
      this.advancePlaying(deltaMs);
    }
    return this.drain();
  }

  private advancePlaying(deltaMs: number): void {
    this.elapsedMs += deltaMs;

    this.player.advance(deltaMs);
    this.collect("player");

    this.cpuDriver.advance(deltaMs);
    this.cpu.advance(deltaMs);
    this.collect("cpu");

    this.checkEnd();
  }

  feedKey(key: string): TaggedEvent[] {
    if (this.phase === "playing") {
      this.player.feedKey(key);
      this.collect("player");
    }
    return this.drain();
  }

  triggerBurst(): TaggedEvent[] {
    if (this.phase === "playing") {
      this.player.triggerBurst();
      this.collect("player");
    }
    return this.drain();
  }

  cancelSelection(): TaggedEvent[] {
    if (this.phase === "playing") {
      this.player.cancelSelection();
      this.collect("player");
    }
    return this.drain();
  }

  /** イベントを回収しつつ、攻撃(chainFinished)を妨害へ変換する */
  private collect(side: "player" | "cpu"): void {
    const core = side === "player" ? this.player : this.cpu;
    const opponent = side === "player" ? this.cpu : this.player;
    const opponentSide = side === "player" ? "cpu" : "player";

    const drained = core.drainEvents();
    for (const event of drained) {
      this.events.push({ side, event });
      if (event.type === "chainFinished" && event.garbageCount > 0 && this.winner === null) {
        // 自分の着弾待ちを先に相殺し、残りを相手へ送る(§12.3)
        const leftover = core.cancelIncoming(event.garbageCount);
        if (leftover > 0) {
          core.recordGarbageSent(leftover);
          opponent.receiveGarbage(leftover);
        }
        for (const e of core.drainEvents()) this.events.push({ side, event: e });
        for (const e of opponent.drainEvents()) this.events.push({ side: opponentSide, event: e });
      }
    }
  }

  private checkEnd(): void {
    if (this.winner !== null) return;
    const playerOut = this.player.toppedOut;
    const cpuOut = this.cpu.toppedOut;
    if (!playerOut && !cpuOut) return;

    // 同時なら引き分け扱いでプレイヤー勝利にはしない → CPU勝利より公平な player 判定: スコア比較
    if (playerOut && cpuOut) {
      this.winner =
        this.player.getSnapshot().score >= this.cpu.getSnapshot().score ? "player" : "cpu";
    } else {
      this.winner = playerOut ? "cpu" : "player";
    }

    this.player.flushResolving();
    this.cpu.flushResolving();
    this.player.frozen = true;
    this.cpu.frozen = true;
    this.collectRemaining();
    this.phase = "ended";
    this.events.push({
      side: "player",
      event: { type: "duelFinished", summary: this.getSummary() },
    });
  }

  private collectRemaining(): void {
    for (const e of this.player.drainEvents()) this.events.push({ side: "player", event: e });
    for (const e of this.cpu.drainEvents()) this.events.push({ side: "cpu", event: e });
  }

  getSnapshot(): DuelSnapshot {
    return {
      mode: "duel",
      phase: this.phase,
      countdownMsLeft: this.countdownMsLeft,
      elapsedMs: this.elapsedMs,
      player: this.player.getSnapshot(),
      cpu: this.cpu.getSnapshot(),
      winner: this.winner,
    };
  }

  getSummary(): DuelSummary {
    return {
      seed: this.seed,
      won: this.winner === "player",
      durationMs: this.elapsedMs,
      difficulty: this.difficulty,
      player: this.player.getSummary(),
      cpu: this.cpu.getSummary(),
    };
  }

  /** テスト・デバッグ用 */
  getCores(): { player: PlayerCore; cpu: PlayerCore } {
    return { player: this.player, cpu: this.cpu };
  }

  private drain(): TaggedEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }
}
