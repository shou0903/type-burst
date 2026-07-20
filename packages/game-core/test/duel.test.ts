import { describe, expect, it } from "vitest";
import { DuelGame } from "@type-blast/game-core";
import type { Attribute, Block, TaggedEvent } from "@type-blast/game-core";
import { GARBAGE_PHRASES, PHRASES } from "@type-blast/phrase-content";
import { TypingAutomaton } from "@type-blast/typing-engine";

function newDuel(seed = "duel-seed", difficulty: "easy" | "normal" | "hard" = "easy"): DuelGame {
  return new DuelGame(seed, PHRASES, GARBAGE_PHRASES, difficulty);
}

let idCounter = 2000;
function block(row: number, col: number, attribute: Attribute | null, phraseIndex: number): Block {
  idCounter += 1;
  const phrase = PHRASES[phraseIndex]!;
  return {
    id: idCounter,
    kind: attribute === null ? "garbage" : "normal",
    attribute,
    phraseId: phrase.id,
    displayText: phrase.displayText,
    readingKana: phrase.readingKana,
    row,
    col,
  };
}

function setPlayerBoard(game: DuelGame, blocks: Block[]): void {
  const core = game.getCores().player as unknown as {
    blocks: Block[];
    automatons: Map<number, unknown>;
    candidateIds: Set<number> | null;
    lockedId: number | null;
  };
  core.blocks = blocks;
  core.automatons = new Map();
  core.candidateIds = null;
  core.lockedId = null;
}

describe("CPU対戦", () => {
  it("CPUが実際にタイピングしてブロックを消す", () => {
    const game = newDuel("cpu-types", "hard");
    game.advance(3000);
    for (let i = 0; i < 200 && game.getSnapshot().phase === "playing"; i++) {
      game.advance(100); // 20秒
    }
    const cpu = game.getSnapshot().cpu;
    expect(cpu.score).toBeGreaterThan(0);
    expect(game.getCores().cpu.getSummary().phraseCount).toBeGreaterThan(0);
  });

  it("プレイヤーの連鎖が妨害としてCPUへ送られる", () => {
    const game = newDuel("garbage-send", "easy");
    game.advance(3000);
    // 2連鎖(colored 7個 + chainBonus 2 + 同時1 = 攻撃力10 → 妨害2個)を作る
    const trigger = block(1, 0, "fire", 2);
    setPlayerBoard(game, [
      block(0, 0, "fire", 3),
      block(0, 1, "fire", 4),
      trigger,
      block(1, 1, "water", 5),
      block(0, 2, "water", 6),
      block(0, 3, "water", 7),
      block(0, 4, "water", 8),
    ]);
    const events: TaggedEvent[] = [];
    const romaji = new TypingAutomaton(trigger.readingKana).getCanonicalRomaji();
    for (const key of romaji) events.push(...game.feedKey(key));
    events.push(...game.advance(1200)); // 連鎖解決

    const sent = events.find((t) => t.side === "player" && t.event.type === "garbageSent");
    const incoming = events.find((t) => t.side === "cpu" && t.event.type === "garbageIncoming");
    expect(sent).toBeDefined();
    expect(incoming).toBeDefined();

    // 1.5秒の予告後に着弾する
    events.push(...game.advance(2000));
    const landed = events.find((t) => t.side === "cpu" && t.event.type === "garbageLanded");
    expect(landed).toBeDefined();
    const cpuGarbage = game.getSnapshot().cpu.blocks.filter((b) => b.kind === "garbage");
    expect(cpuGarbage.length).toBeGreaterThan(0);
  });

  it("放置プレイヤーはトップアウトして敗北する", () => {
    const game = newDuel("player-idle", "hard");
    game.advance(3000);
    const events: TaggedEvent[] = [];
    for (let i = 0; i < 3000 && game.getSnapshot().phase !== "ended"; i++) {
      events.push(...game.advance(100));
    }
    expect(game.getSnapshot().phase).toBe("ended");
    const summary = game.getSummary();
    expect(summary.won).toBe(false);
    expect(events.some((t) => t.event.type === "duelFinished")).toBe(true);
  });

  it("同じSeedと同じ操作から同じ結果になる(CPU含めて決定論)", () => {
    const run = () => {
      const game = newDuel("replay-duel", "normal");
      game.advance(3000);
      for (let i = 0; i < 600 && game.getSnapshot().phase !== "ended"; i++) {
        game.feedKey("k");
        game.advance(100);
      }
      const s = game.getSnapshot();
      return JSON.stringify({
        winner: s.winner,
        p: s.player.score,
        c: s.cpu.score,
        pb: s.player.blocks.length,
        cb: s.cpu.blocks.length,
      });
    };
    expect(run()).toBe(run());
  });
});
