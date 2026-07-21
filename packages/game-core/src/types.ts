export type Attribute = "fire" | "water" | "wind" | "light";

/** bomb = 3×3爆破、prism = 最多属性の全消し(特殊ブロック) */
export type BlockKind = "normal" | "garbage" | "bomb" | "prism";

export const ATTRIBUTES: readonly Attribute[] = ["fire", "water", "wind", "light"];

export interface Block {
  id: number;
  kind: BlockKind;
  attribute: Attribute | null;
  phraseId: string;
  displayText: string;
  readingKana: string;
  /** 0 = 最下段 */
  row: number;
  col: number;
}

/** チュートリアルの各ステップで盤面を任意の内容に差し替えるための指定。スコア・ランキングには一切影響しない */
export interface TutorialBlockSpec {
  row: number;
  col: number;
  attribute: Attribute | null;
  kind?: BlockKind;
  phraseId: string;
  displayText: string;
  readingKana: string;
}

export type BlockViewState = "idle" | "candidate" | "locked" | "clearing";

export interface BlockView {
  id: number;
  kind: BlockKind;
  attribute: Attribute | null;
  displayText: string;
  row: number;
  col: number;
  state: BlockViewState;
  /** 入力進捗 0〜1(candidate / locked のみ有効) */
  progress: number;
}

export interface ClearedBlockInfo {
  id: number;
  row: number;
  col: number;
  attribute: Attribute | null;
  kind: BlockKind;
}

/** 消去の原因(演出・音の差別化用) */
export type ClearCause = "direct" | "auto" | "bomb" | "prism" | "burst";

export type GameEvent =
  | { type: "countdownTick"; secondsLeft: number }
  | { type: "started" }
  | { type: "keyAccepted" }
  | { type: "keyRejected" }
  | { type: "targetLocked"; blockId: number }
  | { type: "selectionReset" }
  | { type: "phraseCompleted"; blockId: number; perfect: boolean }
  | {
      type: "blocksCleared";
      blocks: ClearedBlockInfo[];
      chain: number;
      largestGroupSize: number;
      cause: ClearCause;
      scoreGained: number;
    }
  | { type: "chainFinished"; depth: number; attackPower: number; garbageCount: number; scoreGained: number }
  | { type: "burstReady" }
  | { type: "burstFired" }
  | { type: "garbageIncoming"; count: number }
  | { type: "garbageCancelled"; count: number }
  | { type: "garbageLanded"; count: number }
  | { type: "garbageSent"; count: number }
  | { type: "riseWarning" }
  | { type: "rowDropped" }
  | { type: "selectionCancelled" }
  | { type: "allClear"; bonus: number }
  | { type: "levelUp"; level: number; bonus: number }
  | { type: "dangerChanged"; danger: boolean }
  | { type: "toppedOut" }
  | { type: "survivalFinished"; summary: SurvivalSummary }
  | { type: "duelFinished"; summary: DuelSummary };

/** DUEL では発生元プレイヤーを付けて返す */
export interface TaggedEvent {
  side: "player" | "cpu";
  event: GameEvent;
}

export type GamePhase = "countdown" | "playing" | "ended";

export interface PlayerSnapshot {
  score: number;
  blocks: BlockView[];
  lockedBlockId: number | null;
  candidateBlockIds: number[];
  targetDisplayText: string | null;
  typedRomaji: string;
  remainingRomaji: string;
  resolving: boolean;
  currentChain: number;
  maxChain: number;
  kpm: number;
  accuracy: number;
  danger: boolean;
  toppedOut: boolean;
  /** 次の行上昇までの進行 0〜1 */
  risePressure: number;
  riseWarningActive: boolean;
  /** 必殺技ゲージ 0〜1 */
  gauge: number;
  burstReady: boolean;
  /** 連続 PERFECT 数 */
  perfectStreak: number;
  /** 着弾待ちの妨害ブロック数 */
  incomingGarbage: number;
  garbageSentTotal: number;
}

export interface SurvivalSnapshot {
  mode: "survival";
  phase: GamePhase;
  countdownMsLeft: number;
  elapsedMs: number;
  /** 30秒ごとに上がるレベル */
  level: number;
  player: PlayerSnapshot;
}

export interface DuelSnapshot {
  mode: "duel";
  phase: GamePhase;
  countdownMsLeft: number;
  elapsedMs: number;
  player: PlayerSnapshot;
  cpu: PlayerSnapshot;
  winner: "player" | "cpu" | null;
}

export interface PlayerSummary {
  score: number;
  maxChain: number;
  kpm: number;
  accuracy: number;
  phraseCount: number;
  perfectPhraseCount: number;
  correctKeyCount: number;
  incorrectKeyCount: number;
  garbageSent: number;
  burstCount: number;
}

export interface SurvivalSummary extends PlayerSummary {
  seed: string;
  survivedMs: number;
  level: number;
  difficulty: SurvivalDifficulty;
}

export interface DuelSummary {
  seed: string;
  won: boolean;
  durationMs: number;
  difficulty: CpuDifficulty;
  player: PlayerSummary;
  cpu: PlayerSummary;
}

export type CpuDifficulty = "easy" | "normal" | "hard";
export type SurvivalDifficulty = "easy" | "normal" | "hard";
