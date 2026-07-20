import { describe, expect, it } from "vitest";
import { TutorialGame } from "@type-burst/game-core";
import type { GameEvent } from "@type-burst/game-core";
import { GARBAGE_PHRASES, PHRASES } from "@type-burst/phrase-content";
import { TypingAutomaton } from "@type-burst/typing-engine";

function newTutorial(): TutorialGame {
  return new TutorialGame(PHRASES, GARBAGE_PHRASES);
}

function romajiForDisplayText(displayText: string): string {
  const phrase =
    PHRASES.find((p) => p.displayText === displayText) ??
    GARBAGE_PHRASES.find((p) => p.displayText === displayText);
  if (!phrase) throw new Error(`phrase not found for displayText: ${displayText}`);
  return new TypingAutomaton(phrase.readingKana).getCanonicalRomaji();
}

function typeBlock(game: TutorialGame, displayText: string): GameEvent[] {
  const romaji = romajiForDisplayText(displayText);
  const events: GameEvent[] = [];
  for (const key of romaji) {
    events.push(...game.feedKey(key));
    events.push(...game.advance(200));
  }
  events.push(...game.advance(3000));
  return events;
}

describe("チュートリアル(D-035)", () => {
  it("全7ステップあり、最初はステップ0(基本操作)で未達成", () => {
    const game = newTutorial();
    const snap = game.getSnapshot();
    expect(snap.totalSteps).toBe(7);
    expect(snap.stepIndex).toBe(0);
    expect(snap.requiresInteraction).toBe(true);
    expect(snap.stepComplete).toBe(false);
  });

  it("未達成のステップではnextStepを呼んでも進まない", () => {
    const game = newTutorial();
    game.nextStep();
    expect(game.getSnapshot().stepIndex).toBe(0);
  });

  it("ステップ0: ブロックを打つと消えてstepCompleteになり、次へ進める", () => {
    const game = newTutorial();
    const target = game.getSnapshot().player.blocks[0]!;
    typeBlock(game, target.displayText);
    expect(game.getSnapshot().stepComplete).toBe(true);
    game.nextStep();
    expect(game.getSnapshot().stepIndex).toBe(1);
  });

  it("ステップ1: 連鎖デモで2連鎖以上を達成できる", () => {
    const game = newTutorial();
    const target = game.getSnapshot().player.blocks[0]!;
    typeBlock(game, target.displayText);
    game.nextStep();
    expect(game.getSnapshot().stepIndex).toBe(1);

    const trigger = game.getSnapshot().player.blocks.find((b) => b.row === 0)!;
    typeBlock(game, trigger.displayText);
    expect(game.getSnapshot().stepComplete).toBe(true);
    expect(game.getSnapshot().player.blocks).toHaveLength(0);
  });

  it("ステップ2: ゲージMAXでTYPE BURSTを発動できる", () => {
    const game = newTutorial();
    for (let i = 0; i < 2; i++) {
      const t = game.getSnapshot().player.blocks[0]!;
      typeBlock(game, t.displayText);
      game.nextStep();
    }
    expect(game.getSnapshot().stepIndex).toBe(2);
    expect(game.getSnapshot().player.burstReady).toBe(true);
    const events = game.triggerBurst();
    game.advance(2000);
    expect(events.some((e) => e.type === "burstFired")).toBe(true);
    expect(game.getSnapshot().stepComplete).toBe(true);
  });

  it("ステップ3: ボムを入力すると周囲を巻き込んで消える", () => {
    const game = newTutorial();
    for (let i = 0; i < 2; i++) {
      const t = game.getSnapshot().player.blocks[0]!;
      typeBlock(game, t.displayText);
      game.nextStep();
    }
    game.triggerBurst();
    game.advance(2000);
    game.nextStep();
    expect(game.getSnapshot().stepIndex).toBe(3);
    const bomb = game.getSnapshot().player.blocks.find((b) => b.kind === "bomb")!;
    expect(bomb).toBeDefined();
    const before = game.getSnapshot().player.blocks.length;
    typeBlock(game, bomb.displayText);
    const after = game.getSnapshot().player.blocks.length;
    expect(after).toBeLessThan(before);
    expect(game.getSnapshot().stepComplete).toBe(true);
  });

  it("最終ステップは説明のみでrequiresInteraction=false", () => {
    const game = newTutorial();
    // 全ステップをスキップ相当で進める(各ステップの達成条件を満たしながら)
    // ここでは単純に、最後のステップまでnextStepを繰り返し呼び、達成できるものは達成させる
    for (let i = 0; i < 10; i++) {
      const snap = game.getSnapshot();
      if (snap.isLastStep) break;
      if (snap.requiresInteraction && !snap.stepComplete) {
        if (snap.stepIndex === 2) {
          game.triggerBurst();
          game.advance(2000);
        } else {
          const block = game.getSnapshot().player.blocks[0];
          if (block) typeBlock(game, block.displayText);
        }
      }
      game.nextStep();
    }
    const finalSnap = game.getSnapshot();
    expect(finalSnap.isLastStep).toBe(true);
    expect(finalSnap.requiresInteraction).toBe(false);
    expect(finalSnap.stepComplete).toBe(true);
  });
});
