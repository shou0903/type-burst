import { TypingAutomaton } from "@type-burst/typing-engine";
import type { JapanesePhrase, PhraseTier } from "@type-burst/phrase-content";
import {
  applyGravity,
  findAdjacentGarbage,
  findAutoGroups,
  findGroup,
  highestRow,
} from "./board";
import type { GameConfig, RiseConfig } from "./config";
import { Prng } from "./prng";
import {
  ATTRIBUTES,
  type Attribute,
  type Block,
  type BlockView,
  type ClearCause,
  type ClearedBlockInfo,
  type FingerStat,
  type GameEvent,
  type HandStat,
  type KeyStat,
  type PaceSegment,
  type PlayerSnapshot,
  type PlayerSummary,
  type TutorialBlockSpec,
  type TypingAnalysis,
} from "./types";

interface ResolvingState {
  stage: "hitstop" | "clearing" | "falling";
  stageMsLeft: number;
  chainDepth: number;
  clearingBlocks: Block[];
  largestGroupSize: number;
  cause: ClearCause;
  /** バースト起因の解決はゲージを再充填しない */
  fromBurst: boolean;
  /** この解決全体の集計(攻撃力計算用) */
  coloredCleared: number;
  garbageDestroyed: number;
  maxGroupSize: number;
}

interface IncomingGarbage {
  count: number;
  msLeft: number;
}

const KEY_PATTERN = /^[a-z'-]$/;

/** タッチタイピングの標準的な運指(D-049: 指ごとの苦手分析用) */
const FINGER_OF_KEY: Record<string, string> = {
  q: "left-pinky",
  a: "left-pinky",
  z: "left-pinky",
  w: "left-ring",
  s: "left-ring",
  x: "left-ring",
  e: "left-middle",
  d: "left-middle",
  c: "left-middle",
  r: "left-index",
  f: "left-index",
  v: "left-index",
  t: "left-index",
  g: "left-index",
  b: "left-index",
  y: "right-index",
  h: "right-index",
  n: "right-index",
  u: "right-index",
  j: "right-index",
  m: "right-index",
  i: "right-middle",
  k: "right-middle",
  o: "right-ring",
  l: "right-ring",
  p: "right-pinky",
  "-": "right-pinky",
};

const FINGER_LABELS: Record<string, string> = {
  "left-pinky": "左手小指",
  "left-ring": "左手薬指",
  "left-middle": "左手中指",
  "left-index": "左手人差し指",
  "right-index": "右手人差し指",
  "right-middle": "右手中指",
  "right-ring": "右手薬指",
  "right-pinky": "右手小指",
};

const FINGER_ORDER = Object.keys(FINGER_LABELS);

function handOfKey(key: string): "left" | "right" | null {
  const finger = FINGER_OF_KEY[key];
  if (!finger) return null;
  return finger.startsWith("left") ? "left" : "right";
}

/**
 * 1プレイヤー分の盤面・入力・連鎖・ゲージ・妨害の権威状態。
 * 時間は advance(deltaMs) でのみ進む(決定論)。
 */
export class PlayerCore {
  private readonly config: GameConfig;
  private readonly rise: RiseConfig;
  private readonly rng: Prng;
  private readonly phrasePool: readonly JapanesePhrase[];
  private readonly garbagePool: readonly JapanesePhrase[];
  private readonly firstKeyCache = new Map<string, string>();

  private blocks: Block[] = [];
  private nextBlockId = 1;
  private elapsedMs = 0;

  private riseTimerMs: number;
  private riseWarningIssued = false;

  private resolving: ResolvingState | null = null;

  private automatons = new Map<number, TypingAutomaton>();
  private candidateIds: Set<number> | null = null;
  private lockedId: number | null = null;
  private phraseAttemptMissed = false;

  private correctKeys = 0;
  private wrongKeys = 0;
  /** タイピング分析用の打鍵ログ(D-048) */
  private keyLog: { key: string; correct: boolean; atMs: number }[] = [];
  private phraseCount = 0;
  private perfectPhraseCount = 0;
  private perfectStreak = 0;
  private maxChain = 0;
  private score = 0;
  private gauge = 0;
  private burstCount = 0;
  private garbageSentTotal = 0;
  private incoming: IncomingGarbage[] = [];
  private danger = false;
  /** フィーバータイム残り時間(ms)。0ならフィーバーではない(D-052) */
  private feverMsLeft = 0;
  toppedOut = false;
  frozen = false;
  /** チュートリアル専用: trueの間は行上昇(dropRow)だけを止める。入力や連鎖の演出は通常通り動く */
  pauseRise = false;

  private events: GameEvent[] = [];

  constructor(
    seed: string,
    phrases: readonly JapanesePhrase[],
    garbagePhrases: readonly JapanesePhrase[],
    config: GameConfig,
    rise: RiseConfig,
  ) {
    this.config = config;
    this.rise = rise;
    this.rng = new Prng(seed);
    this.phrasePool = phrases.filter((p) => p.enabled);
    this.garbagePool = garbagePhrases.filter((p) => p.enabled);
    if (this.phrasePool.length < 10) {
      throw new Error("game-core: 問題データが不足しています");
    }
    this.riseTimerMs = rise.startIntervalMs;
    this.generateInitialBoard();
  }

  /** 溜まったイベントを取り出す(取り出した分は消える) */
  drainEvents(): GameEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /**
   * チュートリアル専用: 盤面を指定の内容へ丸ごと差し替える。
   * スコア・ゲージ・連鎖記録はステップ切り替え時にリセットされ、本番のランキングには一切関与しない。
   */
  loadTutorialBoard(spec: readonly TutorialBlockSpec[], gauge = 0): void {
    this.blocks = spec.map((s) => ({
      id: this.nextBlockId++,
      kind: s.kind ?? "normal",
      attribute: s.attribute,
      phraseId: s.phraseId,
      displayText: s.displayText,
      readingKana: s.readingKana,
      row: s.row,
      col: s.col,
    }));
    this.automatons = new Map();
    this.candidateIds = null;
    this.lockedId = null;
    this.resolving = null;
    this.toppedOut = false;
    this.perfectStreak = 0;
    this.gauge = Math.max(0, Math.min(this.config.special.gaugeMax, gauge));
    // チュートリアルのステップ切り替えでフィーバーが持ち越されないようにする
    this.feverMsLeft = 0;
  }

  // ------------------------------------------------------------------
  // 時間進行
  // ------------------------------------------------------------------

  advance(deltaMs: number): void {
    if (this.frozen || deltaMs <= 0) return;
    this.elapsedMs += deltaMs;
    this.advanceFever(deltaMs);

    if (this.resolving) {
      this.advanceResolving(deltaMs);
    } else {
      this.advanceGarbageDrop(deltaMs);
      if (!this.resolving && !this.frozen && !this.toppedOut && !this.pauseRise) {
        this.advanceRise(deltaMs);
      }
    }
  }

  private advanceResolving(deltaMs: number): void {
    let budget = deltaMs;
    while (this.resolving && budget > 0) {
      const consume = Math.min(budget, this.resolving.stageMsLeft);
      this.resolving.stageMsLeft -= consume;
      budget -= consume;
      if (this.resolving.stageMsLeft <= 0) {
        this.stepResolving();
      }
    }
  }

  private advanceGarbageDrop(deltaMs: number): void {
    if (this.incoming.length === 0) return;
    for (const item of this.incoming) {
      item.msLeft -= deltaMs;
    }
    while (this.incoming.length > 0 && this.incoming[0]!.msLeft <= 0) {
      const item = this.incoming.shift()!;
      this.landGarbage(item.count);
      if (this.toppedOut) return;
    }
  }

  currentRiseInterval(): number {
    const shrunk =
      this.rise.startIntervalMs - (this.elapsedMs / 1000) * this.rise.accelPerSecondMs;
    return Math.max(this.rise.minIntervalMs, shrunk);
  }

  private advanceRise(deltaMs: number): void {
    this.riseTimerMs -= deltaMs;
    if (!this.riseWarningIssued && this.riseTimerMs <= this.rise.warningMs) {
      this.riseWarningIssued = true;
      this.emit({ type: "riseWarning" });
    }
    while (this.riseTimerMs <= 0 && !this.toppedOut) {
      this.dropRow();
      this.riseTimerMs += this.currentRiseInterval();
      this.riseWarningIssued = false;
    }
  }

  // ------------------------------------------------------------------
  // 入力処理
  // ------------------------------------------------------------------

  feedKey(rawKey: string): void {
    const key = rawKey.toLowerCase();
    if (this.frozen || this.toppedOut || this.resolving !== null || !KEY_PATTERN.test(key)) {
      return;
    }
    if (this.lockedId !== null) {
      this.feedLocked(key);
    } else {
      this.feedCandidates(key);
    }
  }

  private feedLocked(key: string): void {
    const automaton = this.automatons.get(this.lockedId!);
    const block = this.blocks.find((b) => b.id === this.lockedId);
    if (!automaton || !block) {
      this.resetSelection();
      return;
    }
    const result = automaton.feed(key);
    if (!result.accepted) {
      this.wrongKeys += 1;
      this.phraseAttemptMissed = true;
      this.logKey(key, false);
      this.emit({ type: "keyRejected" });
      return;
    }
    this.logKey(key, true);
    this.acceptKey();
    if (result.completed) {
      this.completePhrase(block);
    }
  }

  private feedCandidates(key: string): void {
    const startingFresh = this.candidateIds === null;
    const targetIds = startingFresh
      ? this.blocks.map((b) => b.id)
      : [...this.candidateIds!];

    const accepted: number[] = [];
    let completedBlock: Block | null = null;
    for (const id of targetIds) {
      const block = this.blocks.find((b) => b.id === id);
      if (!block) continue;
      const automaton = this.ensureAutomaton(block);
      const result = automaton.feed(key);
      if (result.accepted) {
        accepted.push(id);
        if (result.completed && completedBlock === null) {
          completedBlock = block;
        }
      }
    }

    if (accepted.length === 0) {
      this.wrongKeys += 1;
      this.phraseAttemptMissed = true;
      this.logKey(key, false);
      this.resetSelection();
      this.emit({ type: "keyRejected" });
      this.emit({ type: "selectionReset" });
      return;
    }

    this.candidateIds = new Set(accepted);
    this.logKey(key, true);
    this.acceptKey();

    if (completedBlock) {
      this.completePhrase(completedBlock);
      return;
    }
    if (accepted.length === 1) {
      this.lockedId = accepted[0]!;
      this.emit({ type: "targetLocked", blockId: this.lockedId });
    }
  }

  private acceptKey(): void {
    this.correctKeys += 1;
    this.score += this.applyFeverMultiplier(this.config.score.perCorrectKey);
    this.emit({ type: "keyAccepted" });
  }

  /** タイピング分析用に1打鍵を記録する(D-048) */
  private logKey(key: string, correct: boolean): void {
    this.keyLog.push({ key, correct, atMs: this.elapsedMs });
  }

  private ensureAutomaton(block: Block): TypingAutomaton {
    let automaton = this.automatons.get(block.id);
    if (!automaton) {
      automaton = new TypingAutomaton(block.readingKana);
      this.automatons.set(block.id, automaton);
    }
    return automaton;
  }

  private resetSelection(): void {
    this.candidateIds = null;
    this.lockedId = null;
    for (const block of this.blocks) {
      this.automatons.get(block.id)?.reset();
    }
  }

  /** 選択中・入力中のブロックをキャンセルする(ミス扱いにしない) */
  cancelSelection(): void {
    if (this.frozen || this.toppedOut || this.resolving !== null) return;
    if (this.lockedId === null && this.candidateIds === null) return;
    this.resetSelection();
    this.emit({ type: "selectionCancelled" });
  }

  /** モード側からのボーナス加点(レベルアップ等) */
  addScore(amount: number): void {
    if (amount > 0) this.score += amount;
  }

  // ------------------------------------------------------------------
  // TYPE BURST(必殺技)
  // ------------------------------------------------------------------

  get burstReady(): boolean {
    return this.gauge >= this.config.special.gaugeMax;
  }

  triggerBurst(): boolean {
    if (this.frozen || this.toppedOut || this.resolving !== null || !this.burstReady) {
      return false;
    }
    const targets = this.blocks.filter((b) => b.row < this.config.special.burstRows);
    if (targets.length === 0) return false;
    this.gauge = 0;
    this.burstCount += 1;
    this.score += this.applyFeverMultiplier(this.config.special.burstBaseScore);
    this.emit({ type: "burstFired" });
    this.startResolving(targets, 1, "burst", targets.length);
    return true;
  }

  private addGauge(amount: number): void {
    if (amount <= 0) return;
    const wasReady = this.burstReady;
    this.gauge = Math.min(this.config.special.gaugeMax, this.gauge + amount);
    if (!wasReady && this.burstReady) {
      this.emit({ type: "burstReady" });
    }
  }

  // ------------------------------------------------------------------
  // フィーバータイム(D-052): 大連鎖を達成すると一定時間スコア倍率がかかる
  // ------------------------------------------------------------------

  get feverActive(): boolean {
    return this.feverMsLeft > 0;
  }

  private advanceFever(deltaMs: number): void {
    if (this.feverMsLeft <= 0) return;
    this.feverMsLeft = Math.max(0, this.feverMsLeft - deltaMs);
    if (this.feverMsLeft === 0) {
      this.emit({ type: "feverEnded" });
    }
  }

  /** 大連鎖達成時に呼ぶ。未発動なら開始、発動中ならフルタイムへ延長する(延長方式) */
  private triggerFever(): void {
    const wasActive = this.feverActive;
    this.feverMsLeft = this.config.fever.durationMs;
    if (!wasActive) {
      this.emit({ type: "feverStarted" });
    }
  }

  /** フィーバー中はスコア加算を config.fever.scoreMultiplier 倍にする */
  private applyFeverMultiplier(amount: number): number {
    if (amount <= 0 || !this.feverActive) return amount;
    return Math.round(amount * this.config.fever.scoreMultiplier);
  }

  // ------------------------------------------------------------------
  // 消去と連鎖
  // ------------------------------------------------------------------

  private completePhrase(trigger: Block): void {
    const perfect = !this.phraseAttemptMissed;
    this.phraseCount += 1;
    if (perfect) {
      this.perfectPhraseCount += 1;
      this.perfectStreak += 1;
      this.score += this.applyFeverMultiplier(this.config.score.perPerfectPhrase);
      this.addGauge(this.config.special.gaugePerPerfect);
    } else {
      this.perfectStreak = 0;
    }
    this.phraseAttemptMissed = false;
    this.emit({ type: "phraseCompleted", blockId: trigger.id, perfect });

    const { columns, visibleRows } = this.config;
    const rows = visibleRows + 2;

    let clearing: Block[];
    let cause: ClearCause;
    let chainDepth: number;
    let groupSize: number;

    if (trigger.kind === "bomb") {
      // 3×3 を吹き飛ばす
      clearing = this.blocks.filter(
        (b) => Math.abs(b.row - trigger.row) <= 1 && Math.abs(b.col - trigger.col) <= 1,
      );
      cause = "bomb";
      chainDepth = 1;
      groupSize = clearing.length;
    } else if (trigger.kind === "prism") {
      // 盤面で最も多い属性を全消去
      const counts = new Map<Attribute, number>();
      for (const b of this.blocks) {
        if (b.attribute !== null) {
          counts.set(b.attribute, (counts.get(b.attribute) ?? 0) + 1);
        }
      }
      let best: Attribute | null = null;
      let bestCount = 0;
      for (const attr of ATTRIBUTES) {
        const count = counts.get(attr) ?? 0;
        if (count > bestCount) {
          best = attr;
          bestCount = count;
        }
      }
      clearing = this.blocks.filter((b) => b.id === trigger.id || (best !== null && b.attribute === best));
      cause = "prism";
      chainDepth = 1;
      groupSize = clearing.length;
    } else {
      const group = findGroup(this.blocks, trigger, columns, rows);
      const direct = group.length >= this.config.chain.directClearMin ? group : [trigger];
      const garbage = findAdjacentGarbage(this.blocks, direct, columns, rows);
      clearing = [...direct, ...garbage];
      cause = "direct";
      chainDepth = direct.length >= this.config.chain.directClearMin ? 1 : 0;
      groupSize = direct.length;
    }

    this.startResolving(clearing, chainDepth, cause, groupSize);
  }

  private startResolving(
    clearing: Block[],
    chainDepth: number,
    cause: ClearCause,
    groupSize: number,
  ): void {
    this.resolving = {
      stage: "hitstop",
      stageMsLeft: this.config.chain.hitStopMs,
      chainDepth,
      clearingBlocks: clearing,
      largestGroupSize: groupSize,
      cause,
      fromBurst: cause === "burst",
      coloredCleared: 0,
      garbageDestroyed: 0,
      maxGroupSize: groupSize,
    };
    this.candidateIds = null;
    this.lockedId = null;
  }

  private stepResolving(): void {
    const resolving = this.resolving;
    if (!resolving) return;
    const { columns, visibleRows } = this.config;
    const rows = visibleRows + 2;

    if (resolving.stage === "hitstop") {
      const gained = this.applyClearScore(resolving.clearingBlocks, !resolving.fromBurst);
      this.trackClearTotals(resolving, resolving.clearingBlocks);
      this.emit({
        type: "blocksCleared",
        blocks: resolving.clearingBlocks.map(toClearedInfo),
        chain: resolving.chainDepth,
        largestGroupSize: resolving.largestGroupSize,
        cause: resolving.cause,
        scoreGained: gained,
      });
      resolving.stage = "clearing";
      resolving.stageMsLeft = this.config.chain.stepMs;
      return;
    }

    if (resolving.stage === "clearing") {
      const clearingIds = new Set(resolving.clearingBlocks.map((b) => b.id));
      this.blocks = this.blocks.filter((b) => !clearingIds.has(b.id));
      for (const id of clearingIds) this.automatons.delete(id);
      applyGravity(this.blocks, columns);
      resolving.stage = "falling";
      resolving.stageMsLeft = this.config.chain.fallMs;
      return;
    }

    // falling → 自動連鎖判定
    const groups = findAutoGroups(this.blocks, this.config.chain.autoClearMin, columns, rows);
    if (groups.length > 0 && resolving.chainDepth < this.config.chain.maxSteps) {
      const cleared = groups.flat();
      const garbage = findAdjacentGarbage(this.blocks, cleared, columns, rows);
      const newDepth = resolving.chainDepth + 1;
      resolving.chainDepth = newDepth;
      resolving.clearingBlocks = [...cleared, ...garbage];
      resolving.largestGroupSize = Math.max(...groups.map((g) => g.length));
      resolving.maxGroupSize = Math.max(resolving.maxGroupSize, resolving.largestGroupSize);
      resolving.cause = "auto";

      if (newDepth >= this.config.chain.bigChainDepth) {
        // 大連鎖スローモー(D-051): 「魅せる」ために一瞬の間(拡張ヒットストップ)を挟んでから
        // 確定させる。決定論を壊さないよう、実時間の進み方(sim time比)自体は一切変えず、
        // ヒットストップの長さをconfig値のみから計算する。反映(スコア加算・イベント発火)は
        // 既存の"hitstop"ステージ処理(このメソッド冒頭)がそのまま行う。
        resolving.stage = "hitstop";
        resolving.stageMsLeft = this.bigChainHitStopMs(newDepth);
        return;
      }

      const gained = this.applyClearScore(resolving.clearingBlocks, !resolving.fromBurst);
      this.trackClearTotals(resolving, resolving.clearingBlocks);
      this.emit({
        type: "blocksCleared",
        blocks: resolving.clearingBlocks.map(toClearedInfo),
        chain: resolving.chainDepth,
        largestGroupSize: resolving.largestGroupSize,
        cause: "auto",
        scoreGained: gained,
      });
      resolving.stage = "clearing";
      resolving.stageMsLeft = this.config.chain.stepMs;
      return;
    }

    // 連鎖終了 → 攻撃力を計算
    const depth = resolving.chainDepth;
    let chainScore = 0;
    if (depth > 0) {
      chainScore = this.applyFeverMultiplier(depth * depth * this.config.score.chainSquareWeight);
      this.score += chainScore;
      if (depth > this.maxChain) this.maxChain = depth;
      if (!resolving.fromBurst) {
        this.addGauge(depth * this.config.special.gaugePerChainDepth);
      }
      if (depth >= this.config.fever.triggerChainDepth) {
        this.triggerFever();
      }
    }

    const attack = this.config.attack;
    const basePower =
      resolving.coloredCleared + resolving.garbageDestroyed * attack.garbageDestroyedWeight;
    const chainBonus = attack.chainBonus[Math.min(depth, attack.chainBonus.length - 1)] ?? 0;
    const simultaneousBonus = Math.max(
      0,
      resolving.maxGroupSize - attack.simultaneousBaseline,
    );
    const perfectBonus =
      this.perfectStreak >= attack.perfectStreakThreshold ? attack.perfectBonus : 0;
    const attackPower =
      depth > 0 ? basePower + chainBonus + simultaneousBonus + perfectBonus : basePower * 0.5;
    const garbageCount = Math.min(
      attack.sendCap,
      Math.floor(attackPower / attack.garbageDivisor),
    );

    this.resolving = null;
    this.emit({ type: "chainFinished", depth, attackPower, garbageCount, scoreGained: chainScore });
    this.resetSelection();

    // 全消しボーナス。次の行をすぐ降らせて手持ち無沙汰を防ぐ
    if (this.blocks.length === 0) {
      const bonus = this.applyFeverMultiplier(this.config.special.allClearBonus);
      this.score += bonus;
      this.addGauge(this.config.special.allClearGauge);
      this.riseTimerMs = Math.min(this.riseTimerMs, 600);
      this.emit({ type: "allClear", bonus });
    }
    this.updateDanger();
  }

  private trackClearTotals(resolving: ResolvingState, blocks: readonly Block[]): void {
    for (const block of blocks) {
      if (block.kind === "garbage") resolving.garbageDestroyed += 1;
      else resolving.coloredCleared += 1;
    }
  }

  private applyClearScore(blocks: readonly Block[], fillGauge: boolean): number {
    let gained = 0;
    for (const block of blocks) {
      if (block.kind === "garbage") gained += this.config.score.perGarbageBlock;
      else if (block.kind === "bomb" || block.kind === "prism") {
        gained += this.config.score.perSpecialBlock;
      } else gained += this.config.score.perColoredBlock;
      if (fillGauge) this.addGauge(this.config.special.gaugePerBlock);
    }
    gained = this.applyFeverMultiplier(gained);
    this.score += gained;
    return gained;
  }

  /** 大連鎖スローモー(D-051)の拡張ヒットストップ時間(ms)。深さに応じて伸び、上限で頭打ちにする */
  private bigChainHitStopMs(depth: number): number {
    const { bigChainDepth, bigChainHitStopMs, bigChainHitStopStepMs, bigChainHitStopMaxMs } =
      this.config.chain;
    const extra = Math.max(0, depth - bigChainDepth) * bigChainHitStopStepMs;
    return Math.min(bigChainHitStopMaxMs, bigChainHitStopMs + extra);
  }

  // ------------------------------------------------------------------
  // 妨害
  // ------------------------------------------------------------------

  /** 相手からの攻撃を予告付きで受け取る */
  receiveGarbage(count: number): void {
    if (count <= 0 || this.frozen) return;
    this.incoming.push({ count, msLeft: this.config.garbage.dropDelayMs });
    this.emit({ type: "garbageIncoming", count });
  }

  /** 自分の攻撃で着弾待ちを相殺する。残った攻撃数を返す */
  cancelIncoming(attackCount: number): number {
    let remaining = attackCount;
    let cancelled = 0;
    while (remaining > 0 && this.incoming.length > 0) {
      const head = this.incoming[0]!;
      const used = Math.min(head.count, remaining);
      head.count -= used;
      remaining -= used;
      cancelled += used;
      if (head.count === 0) this.incoming.shift();
    }
    if (cancelled > 0) {
      this.emit({ type: "garbageCancelled", count: cancelled });
    }
    return remaining;
  }

  recordGarbageSent(count: number): void {
    if (count <= 0) return;
    this.garbageSentTotal += count;
    this.emit({ type: "garbageSent", count });
  }

  private landGarbage(count: number): void {
    const capped = Math.min(count, this.config.garbage.landCapPerDrop);
    const columns = this.rng.shuffle(
      Array.from({ length: this.config.columns }, (_, i) => i),
    );
    let landed = 0;
    for (let i = 0; i < capped; i++) {
      const col = columns[i % columns.length]!;
      let top = -1;
      for (const b of this.blocks) {
        if (b.col === col && b.row > top) top = b.row;
      }
      const row = top + 1;
      if (row >= this.config.visibleRows) {
        this.markToppedOut();
        break;
      }
      const phrase = this.pickGarbagePhrase();
      this.blocks.push({
        id: this.nextBlockId++,
        kind: "garbage",
        attribute: null,
        phraseId: phrase.id,
        displayText: phrase.displayText,
        readingKana: phrase.readingKana,
        row,
        col,
      });
      landed += 1;
    }
    if (landed > 0) {
      this.emit({ type: "garbageLanded", count: landed });
      this.resetSelection();
      this.updateDanger();
    }
  }

  get pendingIncoming(): number {
    return this.incoming.reduce((sum, g) => sum + g.count, 0);
  }

  // ------------------------------------------------------------------
  // 新規行の落下・盤面生成
  // ------------------------------------------------------------------

  /**
   * 新しい行を上から降らせる。各列の山の一番上に1個ずつ積まれる。
   * 積み先が盤面上端を超えた列があればトップアウト。
   */
  private dropRow(): void {
    const { columns, visibleRows } = this.config;
    const heights: number[] = new Array<number>(columns).fill(0);
    for (const b of this.blocks) {
      if (b.row + 1 > heights[b.col]!) heights[b.col] = b.row + 1;
    }

    // 特殊ブロックは盤面全体でボム1個・プリズム1個までに制限する(D-019)。
    // 既に盤面にある場合はロールを消費するだけで通常ブロックへフォールバックし、
    // もう片方の出現確率を誤って底上げしないようにする。
    let hasBomb = this.blocks.some((b) => b.kind === "bomb");
    let hasPrism = this.blocks.some((b) => b.kind === "prism");

    const rowAttrs: (Attribute | null)[] = [];
    let specialPlaced = false;
    for (let col = 0; col < columns; col++) {
      const row = heights[col]!;
      if (row >= visibleRows) {
        this.markToppedOut();
        return;
      }
      // 特殊ブロック(1行に最大1個、かつ盤面全体で種類ごとに最大1個)
      if (!specialPlaced) {
        const roll = this.rng.next();
        if (roll < this.config.special.bombChance) {
          if (!hasBomb) {
            specialPlaced = true;
            hasBomb = true;
            rowAttrs.push(null);
            // 通常ブロックと同じ Tier 分布から選ぶ(短文固定を廃止、D-019)
            this.pushBlock("bomb", null, this.pickPhrase(), row, col);
            continue;
          }
        } else if (roll < this.config.special.bombChance + this.config.special.prismChance) {
          if (!hasPrism) {
            specialPlaced = true;
            hasPrism = true;
            rowAttrs.push(null);
            this.pushBlock("prism", null, this.pickPhrase(), row, col);
            continue;
          }
        }
      }
      const attr = this.pickRowAttribute(rowAttrs);
      rowAttrs.push(attr);
      this.pushBlock("normal", attr, this.pickPhrase(), row, col);
    }
    this.emit({ type: "rowDropped" });
    this.updateDanger();
  }

  private markToppedOut(): void {
    if (this.toppedOut) return;
    this.toppedOut = true;
    this.emit({ type: "toppedOut" });
  }

  private pushBlock(
    kind: Block["kind"],
    attribute: Attribute | null,
    phrase: JapanesePhrase,
    row: number,
    col: number,
  ): void {
    this.blocks.push({
      id: this.nextBlockId++,
      kind,
      attribute,
      phraseId: phrase.id,
      displayText: phrase.displayText,
      readingKana: phrase.readingKana,
      row,
      col,
    });
  }

  private pickRowAttribute(previous: readonly (Attribute | null)[]): Attribute {
    const shuffled = this.rng.shuffle(ATTRIBUTES);
    for (const attr of shuffled) {
      let run = 1;
      for (let i = previous.length - 1; i >= 0 && previous[i] === attr; i--) {
        run += 1;
      }
      if (run < 4) return attr;
    }
    return shuffled[0]!;
  }

  private generateInitialBoard(): void {
    const { columns, initialRows, visibleRows } = this.config;
    for (let row = 0; row < initialRows; row++) {
      for (let col = 0; col < columns; col++) {
        const phrase = this.pickPhrase();
        const block: Block = {
          id: this.nextBlockId++,
          kind: "normal",
          attribute: "fire",
          phraseId: phrase.id,
          displayText: phrase.displayText,
          readingKana: phrase.readingKana,
          row,
          col,
        };
        const shuffled = this.rng.shuffle(ATTRIBUTES);
        let chosen: Attribute = shuffled[0]!;
        for (const attr of shuffled) {
          block.attribute = attr;
          const group = findGroup([...this.blocks, block], block, columns, visibleRows);
          if (group.length < this.config.chain.autoClearMin) {
            chosen = attr;
            break;
          }
        }
        block.attribute = chosen;
        this.blocks.push(block);
      }
    }
  }

  private pickPhrase(forceTier?: PhraseTier): JapanesePhrase {
    const usedIds = new Set(this.blocks.map((b) => b.phraseId));
    const usedFirstKeys = new Set(
      this.blocks.map((b) => this.firstKeyOf(b.phraseId, b.readingKana)),
    );
    const tier = forceTier ?? this.pickTier();

    let pool = this.phrasePool.filter((p) => p.tier === tier && !usedIds.has(p.id));
    if (pool.length === 0) {
      pool = this.phrasePool.filter((p) => !usedIds.has(p.id));
    }
    if (pool.length === 0) {
      pool = [...this.phrasePool];
    }

    // ランダムな開始位置から全候補を1周し、入力列が別ブロックの完成形と
    // 前方一致する語を除外する。「か」と「かき」のような組み合わせで、
    // 長い方を狙っても短い方が先に消えてしまう干渉を防ぐ(D-065)。
    const start = this.rng.int(pool.length);
    let safeFallback: JapanesePhrase | null = null;
    let safeCandidatesChecked = 0;
    for (let offset = 0; offset < pool.length; offset++) {
      const candidate = pool[(start + offset) % pool.length]!;
      if (this.hasTypingConflict(candidate.readingKana)) continue;
      if (safeFallback === null) safeFallback = candidate;
      const first = this.firstKeyOf(candidate.id, candidate.readingKana);
      if (!usedFirstKeys.has(first)) return candidate;
      // 盤面に使える先頭キーは有限なので、全プールを走査してまで重複を
      // 避けようとしない。入力完成形の衝突回避は維持したまま、候補探索を抑える。
      safeCandidatesChecked += 1;
      if (safeCandidatesChecked >= 12) return safeFallback;
    }
    return safeFallback ?? pool[start]!;
  }

  private pickGarbagePhrase(): JapanesePhrase {
    const usedIds = new Set(this.blocks.map((b) => b.phraseId));
    const pool = this.garbagePool.filter((p) => !usedIds.has(p.id));
    const candidates = pool.length > 0 ? pool : this.garbagePool;
    const start = this.rng.int(candidates.length);
    for (let offset = 0; offset < candidates.length; offset++) {
      const candidate = candidates[(start + offset) % candidates.length]!;
      if (!this.hasTypingConflict(candidate.readingKana)) return candidate;
    }
    return candidates[start]!;
  }

  private hasTypingConflict(readingKana: string): boolean {
    return this.blocks.some((block) =>
      TypingAutomaton.hasCompletionPrefixConflict(readingKana, block.readingKana),
    );
  }

  private pickTier(): PhraseTier {
    const ratio = this.config.tierRatio;
    const r = this.rng.next();
    if (r < ratio.micro) return "micro";
    if (r < ratio.micro + ratio.short) return "short";
    if (r < ratio.micro + ratio.short + ratio.standard) return "standard";
    return "long";
  }

  private firstKeyOf(phraseId: string, readingKana: string): string {
    let key = this.firstKeyCache.get(phraseId);
    if (key === undefined) {
      key = new TypingAutomaton(readingKana).getCanonicalRomaji().charAt(0);
      this.firstKeyCache.set(phraseId, key);
    }
    return key;
  }

  // ------------------------------------------------------------------
  // 状態出力
  // ------------------------------------------------------------------

  private updateDanger(): void {
    const nowDanger = highestRow(this.blocks) >= this.config.dangerRow;
    if (nowDanger !== this.danger) {
      this.danger = nowDanger;
      this.emit({ type: "dangerChanged", danger: nowDanger });
    }
  }

  /** 進行中の連鎖を即時解決する(試合終了時) */
  flushResolving(): void {
    let guard = 0;
    while (this.resolving && guard < 200) {
      this.stepResolving();
      guard += 1;
    }
  }

  getSnapshot(): PlayerSnapshot {
    const clearingIds = new Set(
      this.resolving && this.resolving.stage !== "hitstop"
        ? this.resolving.clearingBlocks.map((b) => b.id)
        : [],
    );
    const views: BlockView[] = this.blocks.map((block) => {
      let state: BlockView["state"] = "idle";
      if (clearingIds.has(block.id)) state = "clearing";
      else if (block.id === this.lockedId) state = "locked";
      else if (this.candidateIds?.has(block.id)) state = "candidate";
      const automaton =
        state === "locked" || state === "candidate" ? this.automatons.get(block.id) : undefined;
      return {
        id: block.id,
        kind: block.kind,
        attribute: block.attribute,
        displayText: block.displayText,
        row: block.row,
        col: block.col,
        state,
        progress: automaton ? automaton.getProgress() : 0,
      };
    });

    const lockedAutomaton = this.lockedId !== null ? this.automatons.get(this.lockedId) : undefined;
    const anyCandidate =
      this.candidateIds && this.candidateIds.size > 0
        ? this.automatons.get([...this.candidateIds][0]!)
        : undefined;
    const lockedBlock = this.blocks.find((b) => b.id === this.lockedId);

    return {
      score: this.score,
      blocks: views,
      lockedBlockId: this.lockedId,
      candidateBlockIds: this.candidateIds ? [...this.candidateIds] : [],
      targetDisplayText: lockedBlock?.displayText ?? null,
      typedRomaji: lockedAutomaton?.getTypedRomaji() ?? anyCandidate?.getTypedRomaji() ?? "",
      remainingRomaji: lockedAutomaton?.getRemainingRomaji() ?? "",
      resolving: this.resolving !== null,
      currentChain: this.resolving?.chainDepth ?? 0,
      maxChain: this.maxChain,
      kpm: this.elapsedMs >= 1000 ? (this.correctKeys / (this.elapsedMs / 1000)) * 60 : 0,
      accuracy:
        this.correctKeys + this.wrongKeys === 0
          ? 1
          : this.correctKeys / (this.correctKeys + this.wrongKeys),
      danger: this.danger,
      toppedOut: this.toppedOut,
      risePressure: Math.min(
        1,
        Math.max(0, 1 - this.riseTimerMs / this.currentRiseInterval()),
      ),
      riseWarningActive: this.riseWarningIssued,
      gauge: this.gauge / this.config.special.gaugeMax,
      burstReady: this.burstReady,
      perfectStreak: this.perfectStreak,
      incomingGarbage: this.pendingIncoming,
      garbageSentTotal: this.garbageSentTotal,
      bigChainImpact:
        this.resolving !== null &&
        this.resolving.stage === "hitstop" &&
        this.resolving.chainDepth >= this.config.chain.bigChainDepth,
      feverActive: this.feverActive,
      feverMsLeft: this.feverMsLeft,
    };
  }

  getSummary(): PlayerSummary {
    const seconds = Math.max(1, this.elapsedMs / 1000);
    return {
      score: this.score,
      maxChain: this.maxChain,
      kpm: Math.round((this.correctKeys / seconds) * 60),
      accuracy:
        this.correctKeys + this.wrongKeys === 0
          ? 1
          : this.correctKeys / (this.correctKeys + this.wrongKeys),
      phraseCount: this.phraseCount,
      perfectPhraseCount: this.perfectPhraseCount,
      correctKeyCount: this.correctKeys,
      incorrectKeyCount: this.wrongKeys,
      garbageSent: this.garbageSentTotal,
      burstCount: this.burstCount,
      analysis: this.computeAnalysis(),
    };
  }

  /**
   * 打鍵ログからタイピング分析を集計する(D-048)。
   * キーごとのミス率・平均打鍵間隔を計算し、苦手なキーを抽出する。
   */
  private computeAnalysis(): TypingAnalysis {
    const total = this.keyLog.length;
    const correct = this.keyLog.filter((e) => e.correct).length;
    const incorrect = total - correct;

    const correctIntervals: number[] = [];
    let prevCorrectAt: number | null = null;

    const perKey = new Map<string, { correct: number; incorrect: number; intervals: number[] }>();
    for (const e of this.keyLog) {
      const stat = perKey.get(e.key) ?? { correct: 0, incorrect: 0, intervals: [] };
      if (e.correct) {
        stat.correct += 1;
        if (prevCorrectAt !== null) {
          const interval = e.atMs - prevCorrectAt;
          stat.intervals.push(interval);
          correctIntervals.push(interval);
        }
        prevCorrectAt = e.atMs;
      } else {
        stat.incorrect += 1;
      }
      perKey.set(e.key, stat);
    }

    const average = (values: number[]): number =>
      values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

    const keyStats: KeyStat[] = [...perKey.entries()]
      .map(([key, s]) => ({
        key,
        correct: s.correct,
        incorrect: s.incorrect,
        missRate: s.correct + s.incorrect === 0 ? 0 : s.incorrect / (s.correct + s.incorrect),
        avgIntervalMs: average(s.intervals),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    const MIN_ATTEMPTS_FOR_WEAK = 3;
    const weakKeys = [...keyStats]
      .filter((k) => k.correct + k.incorrect >= MIN_ATTEMPTS_FOR_WEAK && k.incorrect > 0)
      .sort((a, b) => b.missRate - a.missRate || b.avgIntervalMs - a.avgIntervalMs)
      .slice(0, 8);

    // 前半/後半(D-049): 経過時間の中間点で打鍵ログを二分し、疲れ・急ぎによる崩れを検出する
    const segment = (events: readonly { key: string; correct: boolean; atMs: number }[]): PaceSegment => {
      const segCorrect = events.filter((e) => e.correct);
      const segIntervals: number[] = [];
      for (let i = 1; i < segCorrect.length; i++) {
        segIntervals.push(segCorrect[i]!.atMs - segCorrect[i - 1]!.atMs);
      }
      return {
        keystrokes: events.length,
        accuracy: events.length === 0 ? 1 : segCorrect.length / events.length,
        avgIntervalMs: average(segIntervals),
      };
    };
    const allTimes = this.keyLog.map((e) => e.atMs);
    const minMs = allTimes.length === 0 ? 0 : Math.min(...allTimes);
    const maxMs = allTimes.length === 0 ? 0 : Math.max(...allTimes);
    const midMs = (minMs + maxMs) / 2;
    const firstHalf = segment(this.keyLog.filter((e) => e.atMs <= midMs));
    const secondHalf = segment(this.keyLog.filter((e) => e.atMs > midMs));

    // 手・指ごとの集計(D-049: 個別キーより上位の単位で苦手を示す)
    const handAgg = new Map<"left" | "right", { correct: number; incorrect: number }>();
    const fingerAgg = new Map<string, { correct: number; incorrect: number }>();
    for (const k of keyStats) {
      const hand = handOfKey(k.key);
      if (hand) {
        const h = handAgg.get(hand) ?? { correct: 0, incorrect: 0 };
        h.correct += k.correct;
        h.incorrect += k.incorrect;
        handAgg.set(hand, h);
      }
      const finger = FINGER_OF_KEY[k.key];
      if (finger) {
        const f = fingerAgg.get(finger) ?? { correct: 0, incorrect: 0 };
        f.correct += k.correct;
        f.incorrect += k.incorrect;
        fingerAgg.set(finger, f);
      }
    }
    const handStats: HandStat[] = (["left", "right"] as const).map((hand) => {
      const h = handAgg.get(hand) ?? { correct: 0, incorrect: 0 };
      const attempts = h.correct + h.incorrect;
      return { hand, correct: h.correct, incorrect: h.incorrect, missRate: attempts === 0 ? 0 : h.incorrect / attempts };
    });
    const fingerStats: FingerStat[] = FINGER_ORDER.map((finger) => {
      const f = fingerAgg.get(finger) ?? { correct: 0, incorrect: 0 };
      const attempts = f.correct + f.incorrect;
      return {
        finger,
        label: FINGER_LABELS[finger]!,
        correct: f.correct,
        incorrect: f.incorrect,
        missRate: attempts === 0 ? 0 : f.incorrect / attempts,
      };
    });

    return {
      totalKeystrokes: total,
      correctKeystrokes: correct,
      incorrectKeystrokes: incorrect,
      accuracy: total === 0 ? 1 : correct / total,
      averageIntervalMs: average(correctIntervals),
      keyStats,
      weakKeys,
      firstHalf,
      secondHalf,
      handStats,
      fingerStats,
    };
  }

  /** CPU ドライバ用の読み取り専用ビュー */
  getBlocksReadonly(): readonly Block[] {
    return this.blocks;
  }

  get isResolving(): boolean {
    return this.resolving !== null;
  }

  private emit(event: GameEvent): void {
    this.events.push(event);
  }
}

function toClearedInfo(block: Block): ClearedBlockInfo {
  return {
    id: block.id,
    row: block.row,
    col: block.col,
    attribute: block.attribute,
    kind: block.kind,
  };
}
