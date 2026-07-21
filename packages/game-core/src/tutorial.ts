import type { JapanesePhrase } from "@type-burst/phrase-content";
import { DEFAULT_CONFIG, type GameConfig } from "./config";
import { PlayerCore } from "./player";
import type {
  Attribute,
  GameEvent,
  GamePhase,
  PlayerSnapshot,
  TutorialBlockSpec,
} from "./types";

export interface TutorialSnapshot {
  mode: "tutorial";
  phase: GamePhase;
  countdownMsLeft: number;
  elapsedMs: number;
  player: PlayerSnapshot;
  stepIndex: number;
  totalSteps: number;
  stepTitle: string;
  stepInstruction: string;
  /** falseなら「次へ」ボタンだけで進める説明専用のステップ */
  requiresInteraction: boolean;
  /** requiresInteraction時、そのステップの目的を達成したか(達成後に「次へ」が押せるようになる) */
  stepComplete: boolean;
  isLastStep: boolean;
}

interface StepDef {
  title: string;
  instruction: string;
  requiresInteraction: boolean;
  build: () => { blocks: TutorialBlockSpec[]; gauge?: number };
  isComplete: (events: GameEvent[]) => boolean;
}

/** shortティア優先で、被りが少ないようにいくつかの実際の文章を取り出す */
function pickPhrases(phrases: readonly JapanesePhrase[], count: number): JapanesePhrase[] {
  const short = phrases.filter((p) => p.enabled && p.tier === "short");
  const pool = short.length >= count ? short : phrases.filter((p) => p.enabled);
  const picked: JapanesePhrase[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(pool[i % pool.length]!);
  }
  return picked;
}

function toSpec(
  row: number,
  col: number,
  attribute: Attribute | null,
  phrase: JapanesePhrase,
  kind?: "normal" | "bomb" | "prism",
): TutorialBlockSpec {
  return {
    row,
    col,
    attribute,
    kind,
    phraseId: phrase.id,
    displayText: phrase.displayText,
    readingKana: phrase.readingKana,
  };
}

function buildSteps(phrases: readonly JapanesePhrase[]): StepDef[] {
  return [
    {
      title: "1. 基本操作",
      instruction: "ブロックに書かれた日本語をローマ字で入力しよう。打ち終えると爆発するよ。",
      requiresInteraction: true,
      build: () => {
        const [p] = pickPhrases(phrases, 1);
        return { blocks: [toSpec(0, 2, "fire", p!)] };
      },
      isComplete: (events) => events.some((e) => e.type === "blocksCleared"),
    },
    {
      title: "2. 連鎖",
      instruction:
        "同じ色が3個以上つながっていると全部消える。落下してさらに4個以上つながると自動で連鎖するよ。下の3個を入力してみよう。",
      requiresInteraction: true,
      build: () => {
        const ps = pickPhrases(phrases, 3);
        const blocks: TutorialBlockSpec[] = [];
        // トリガー行(消すと直接消去)
        for (let col = 0; col < 3; col++) blocks.push(toSpec(0, col, "fire", ps[col]!));
        // トリガーが消えて落下すると4個以上つながる行(自動連鎖)
        for (let col = 0; col < 3; col++) blocks.push(toSpec(1, col, "water", ps[col]!));
        for (let col = 0; col < 3; col++) blocks.push(toSpec(2, col, "water", ps[col]!));
        return { blocks };
      },
      isComplete: (events) =>
        events.some((e) => e.type === "blocksCleared" && e.chain >= 2),
    },
    {
      title: "3. TYPE BURST",
      instruction:
        "ブロックを消すとゲージが貯まる。満タンで Enter キーを押すと必殺技「TYPE BURST」で下3行を吹き飛ばせるよ。ゲージは満タンにしてあるので、Enterを押してみよう。",
      requiresInteraction: true,
      build: () => {
        const ps = pickPhrases(phrases, 6);
        const attrs: Attribute[] = ["fire", "water", "wind", "light"];
        const blocks: TutorialBlockSpec[] = [];
        let i = 0;
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 6; col++) {
            blocks.push(toSpec(row, col, attrs[(row + col) % attrs.length]!, ps[i % ps.length]!));
            i++;
          }
        }
        return { blocks, gauge: 100 };
      },
      isComplete: (events) => events.some((e) => e.type === "burstFired"),
    },
    {
      title: "4. 特殊ブロック(ボム)",
      instruction: "💣ボムブロックを消すと周囲8マスも巻き込んで爆発するよ。中央のボムを入力してみよう。",
      requiresInteraction: true,
      build: () => {
        const ps = pickPhrases(phrases, 9);
        const attrs: Attribute[] = ["fire", "water", "wind", "light"];
        const blocks: TutorialBlockSpec[] = [];
        let i = 0;
        for (let row = 0; row < 3; row++) {
          for (let col = 1; col < 4; col++) {
            if (row === 1 && col === 2) {
              blocks.push(toSpec(row, col, null, ps[i]!, "bomb"));
            } else {
              blocks.push(toSpec(row, col, attrs[i % attrs.length]!, ps[i]!));
            }
            i++;
          }
        }
        return { blocks };
      },
      isComplete: (events) =>
        events.some((e) => e.type === "blocksCleared" && e.cause === "bomb"),
    },
    {
      title: "5. 特殊ブロック(プリズム)",
      instruction:
        "🌈プリズムブロックを消すと、盤面にある同じ色を全部まとめて消せるよ。プリズムを入力してみよう。",
      requiresInteraction: true,
      build: () => {
        const ps = pickPhrases(phrases, 5);
        const blocks: TutorialBlockSpec[] = [
          toSpec(0, 0, null, ps[0]!, "prism"),
          toSpec(0, 3, "fire", ps[1]!),
          toSpec(1, 5, "fire", ps[2]!),
          toSpec(2, 1, "fire", ps[3]!),
          toSpec(0, 5, "water", ps[4]!),
        ];
        return { blocks };
      },
      isComplete: (events) =>
        events.some((e) => e.type === "blocksCleared" && e.cause === "prism"),
    },
    {
      title: "6. ALL CLEAR",
      instruction: "盤面のブロックを全部消すと「ALL CLEAR」ボーナスが入るよ。残り全部を入力してみよう。",
      requiresInteraction: true,
      build: () => {
        const ps = pickPhrases(phrases, 4);
        const blocks: TutorialBlockSpec[] = [];
        for (let col = 0; col < 4; col++) blocks.push(toSpec(0, col, "light", ps[col]!));
        return { blocks };
      },
      isComplete: (events) => events.some((e) => e.type === "allClear"),
    },
    {
      title: "チュートリアル完了!",
      instruction: "これで基本はバッチリ。さっそく本編で遊んでみよう。",
      requiresInteraction: false,
      build: () => ({ blocks: [] }),
      isComplete: () => true,
    },
  ];
}

/**
 * 操作を1つずつ体験しながら覚えるチュートリアル。
 * 各ステップの盤面は決め打ちで、スコア・ランキングには一切関与しない(D-035)。
 */
export class TutorialGame {
  private readonly core: PlayerCore;
  private readonly steps: StepDef[];
  private stepIndex = 0;
  private stepCompleteFlag = false;
  private elapsedMs = 0;

  constructor(
    phrases: readonly JapanesePhrase[],
    garbagePhrases: readonly JapanesePhrase[],
    config: GameConfig = DEFAULT_CONFIG,
  ) {
    this.core = new PlayerCore(
      "tutorial",
      phrases,
      garbagePhrases,
      config,
      config.survivalDifficulty.normal.rise,
    );
    this.core.pauseRise = true;
    this.steps = buildSteps(phrases);
    this.applyStep();
  }

  private applyStep(): void {
    const step = this.steps[this.stepIndex]!;
    const { blocks, gauge } = step.build();
    this.core.loadTutorialBoard(blocks, gauge ?? 0);
    this.stepCompleteFlag = false;
  }

  private checkComplete(events: GameEvent[]): void {
    if (this.stepCompleteFlag || events.length === 0) return;
    if (this.steps[this.stepIndex]!.isComplete(events)) this.stepCompleteFlag = true;
  }

  advance(deltaMs: number): GameEvent[] {
    if (deltaMs > 0) this.elapsedMs += deltaMs;
    this.core.advance(deltaMs);
    const events = this.core.drainEvents();
    this.checkComplete(events);
    return events;
  }

  feedKey(key: string): GameEvent[] {
    this.core.feedKey(key);
    const events = this.core.drainEvents();
    this.checkComplete(events);
    return events;
  }

  triggerBurst(): GameEvent[] {
    this.core.triggerBurst();
    const events = this.core.drainEvents();
    this.checkComplete(events);
    return events;
  }

  cancelSelection(): GameEvent[] {
    this.core.cancelSelection();
    return this.core.drainEvents();
  }

  /** 次のステップへ進む。次へ進めるのは達成済み(または説明のみ)のステップだけ */
  nextStep(): void {
    const step = this.steps[this.stepIndex]!;
    if (step.requiresInteraction && !this.stepCompleteFlag) return;
    if (this.stepIndex >= this.steps.length - 1) return;
    this.stepIndex += 1;
    this.applyStep();
  }

  getSnapshot(): TutorialSnapshot {
    const step = this.steps[this.stepIndex]!;
    return {
      mode: "tutorial",
      phase: "playing",
      countdownMsLeft: 0,
      elapsedMs: this.elapsedMs,
      player: this.core.getSnapshot(),
      stepIndex: this.stepIndex,
      totalSteps: this.steps.length,
      stepTitle: step.title,
      stepInstruction: step.instruction,
      requiresInteraction: step.requiresInteraction,
      stepComplete: !step.requiresInteraction || this.stepCompleteFlag,
      isLastStep: this.stepIndex === this.steps.length - 1,
    };
  }

  /** テスト・デバッグ用 */
  getCore(): PlayerCore {
    return this.core;
  }
}
