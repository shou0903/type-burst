import { describe, expect, it } from "vitest";
import { SurvivalGame, findAutoGroups } from "@type-burst/game-core";
import type { Attribute, Block, BlockKind, GameEvent, PlayerCore } from "@type-burst/game-core";
import { GARBAGE_PHRASES, PHRASES, VOCAB_THEMES, buildThemedPhrasePool } from "@type-burst/phrase-content";
import { TypingAutomaton } from "@type-burst/typing-engine";

function newGame(seed = "test-seed"): SurvivalGame {
  return new SurvivalGame(seed, PHRASES, GARBAGE_PHRASES);
}

function startPlaying(game: SurvivalGame): GameEvent[] {
  return game.advance(3000);
}

function coreBlocks(game: SurvivalGame): Block[] {
  return (game.getCore() as unknown as { blocks: Block[] }).blocks;
}

function setBoard(game: SurvivalGame, blocks: Block[]): void {
  const core = game.getCore() as unknown as {
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

function setGauge(core: PlayerCore, value: number): void {
  (core as unknown as { gauge: number }).gauge = value;
}

let idCounter = 1000;
function block(
  row: number,
  col: number,
  attribute: Attribute | null,
  phraseIndex: number,
  kind: BlockKind = attribute === null ? "garbage" : "normal",
): Block {
  idCounter += 1;
  const phrase = PHRASES[phraseIndex]!;
  return {
    id: idCounter,
    kind,
    attribute,
    phraseId: phrase.id,
    displayText: phrase.displayText,
    readingKana: phrase.readingKana,
    row,
    col,
  };
}

function typePhrase(game: SurvivalGame, readingKana: string): GameEvent[] {
  const romaji = new TypingAutomaton(readingKana).getCanonicalRomaji();
  const events: GameEvent[] = [];
  for (const key of romaji) {
    events.push(...game.feedKey(key));
  }
  return events;
}

describe("初期盤面", () => {
  it("6列×6行で生成され、4連結グループが存在しない", () => {
    for (const seed of ["a", "b", "c", "duel-42"]) {
      const game = new SurvivalGame(seed, PHRASES, GARBAGE_PHRASES);
      expect(game.getSnapshot().player.blocks).toHaveLength(36);
      expect(findAutoGroups(coreBlocks(game), 4, 6, 12)).toHaveLength(0);
    }
  });

  it("同じSeedなら同じ盤面、異なるSeedなら異なる盤面", () => {
    const a1 = JSON.stringify(newGame("same").getSnapshot().player.blocks);
    const a2 = JSON.stringify(newGame("same").getSnapshot().player.blocks);
    const b = JSON.stringify(newGame("other").getSnapshot().player.blocks);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});

describe("終了条件", () => {
  it("時間では終了しない(トップアウトのみ)", () => {
    const game = newGame();
    startPlaying(game);
    const events: GameEvent[] = [];
    for (let i = 0; i < 1200 && game.getSnapshot().phase !== "ended"; i++) {
      events.push(...game.advance(100));
    }
    // 放置していればいずれ盤面があふれて終わる
    expect(game.getSnapshot().phase).toBe("ended");
    expect(events.some((e) => e.type === "toppedOut")).toBe(true);
    const finished = events.find((e) => e.type === "survivalFinished");
    expect(finished).toBeDefined();
    if (finished?.type === "survivalFinished") {
      // 30秒固定ではない: 行上昇の積み重ねで決まる
      expect(finished.summary.survivedMs).toBeGreaterThan(15000);
    }
  });

  it("行上昇は経過時間とともに加速する", () => {
    const game = newGame();
    startPlaying(game);
    const core = game.getCore();
    const early = core.currentRiseInterval();
    game.advance(60000); // 60秒経過(途中で終了していても interval 計算は進む)
    const late = core.currentRiseInterval();
    expect(late).toBeLessThan(early);
  });
});

describe("連鎖ルール(v1から維持)", () => {
  it("3個直接消去 → 落下 → 4個自動連鎖(2 CHAIN)", () => {
    const game = newGame();
    startPlaying(game);
    const trigger = block(1, 0, "fire", 2);
    setBoard(game, [
      block(0, 0, "fire", 3),
      block(0, 1, "fire", 4),
      trigger,
      block(1, 1, "water", 5),
      block(0, 2, "water", 6),
      block(0, 3, "water", 7),
      block(0, 4, "water", 8),
    ]);
    typePhrase(game, trigger.readingKana);
    const events = game.advance(2000);
    const clears = events.filter((e) => e.type === "blocksCleared");
    expect(clears).toHaveLength(2);
    expect(clears[0]!.chain).toBe(1);
    expect(clears[1]!.chain).toBe(2);
    expect(game.getSnapshot().player.blocks).toHaveLength(0);
    expect(game.getSummary().maxChain).toBe(2);
  });
});

describe("特殊ブロック", () => {
  it("ボムは3×3を吹き飛ばす", () => {
    const game = newGame();
    startPlaying(game);
    const bomb = block(1, 1, null, 2, "bomb");
    setBoard(game, [
      bomb,
      block(0, 0, "fire", 3),
      block(0, 1, "water", 4),
      block(0, 2, "wind", 5),
      block(1, 0, "light", 6),
      block(1, 2, "fire", 7),
      block(2, 1, "water", 8),
      block(0, 4, "wind", 9), // 範囲外
    ]);
    typePhrase(game, bomb.readingKana);
    const events = game.advance(2000);
    const clears = events.filter((e) => e.type === "blocksCleared");
    expect(clears[0]!.cause).toBe("bomb");
    expect(clears[0]!.blocks).toHaveLength(7); // ボム + 周囲6個(範囲外1個は残る)
    expect(clears[0]!.chain).toBe(1);
  });

  it("プリズムは最多属性を全消しする", () => {
    const game = newGame();
    startPlaying(game);
    const prism = block(0, 0, null, 2, "prism");
    setBoard(game, [
      prism,
      block(0, 2, "fire", 3),
      block(0, 4, "fire", 4),
      block(2, 1, "fire", 5),
      block(0, 3, "water", 6),
    ]);
    typePhrase(game, prism.readingKana);
    const events = game.advance(2000);
    const clears = events.filter((e) => e.type === "blocksCleared");
    expect(clears[0]!.cause).toBe("prism");
    // プリズム + fire 3個
    expect(clears[0]!.blocks).toHaveLength(4);
    const remaining = game.getSnapshot().player.blocks;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.attribute).toBe("water");
  });
});

describe("特殊ブロックのバランス調整(v3フィードバック対応, D-019)", () => {
  it("ボム・プリズムは盤面全体で同時に1個までしか存在しない", () => {
    const game = newGame("special-balance");
    const core = game.getCore() as unknown as {
      blocks: Block[];
      dropRow: () => void;
    };
    let maxConcurrentBomb = 0;
    let maxConcurrentPrism = 0;

    for (let i = 0; i < 200; i++) {
      core.dropRow();
      const bombs = core.blocks.filter((b) => b.kind === "bomb");
      const prisms = core.blocks.filter((b) => b.kind === "prism");
      maxConcurrentBomb = Math.max(maxConcurrentBomb, bombs.length);
      maxConcurrentPrism = Math.max(maxConcurrentPrism, prisms.length);
      // 次のドロップのためリセット(出現サンプリング用。盤面オーバーフローを避ける)
      core.blocks = [];
    }

    expect(maxConcurrentBomb).toBeLessThanOrEqual(1);
    expect(maxConcurrentPrism).toBeLessThanOrEqual(1);
  });

  it("ボム・プリズムの文章に多様性がある(短文固定を廃止)", () => {
    const game = newGame("special-variety");
    const core = game.getCore() as unknown as {
      blocks: Block[];
      dropRow: () => void;
    };
    const seenPhraseIds = new Set<string>();
    const seenTiers = new Set<string>();

    for (let i = 0; i < 200; i++) {
      core.dropRow();
      for (const b of core.blocks) {
        if (b.kind !== "bomb" && b.kind !== "prism") continue;
        seenPhraseIds.add(b.phraseId);
        const phrase = PHRASES.find((p) => p.id === b.phraseId);
        if (phrase) seenTiers.add(phrase.tier);
      }
      core.blocks = [];
    }

    // 十分な試行数を確保できていること(このテスト自体の健全性チェック)
    expect(seenPhraseIds.size).toBeGreaterThan(5);
    // short 固定だった旧実装なら standard/long は出現しない
    expect(seenTiers.has("standard") || seenTiers.has("long")).toBe(true);
  });
});

describe("TYPE BURST", () => {
  it("ゲージ満タンで下3行を吹き飛ばし、ゲージが0に戻る", () => {
    const game = newGame();
    startPlaying(game);
    setGauge(game.getCore(), 100);
    expect(game.getSnapshot().player.burstReady).toBe(true);
    const before = game.getSnapshot().player.blocks.length; // 36
    const events = [...game.triggerBurst(), ...game.advance(3000)];
    expect(events.some((e) => e.type === "burstFired")).toBe(true);
    const snapshot = game.getSnapshot().player;
    expect(snapshot.gauge).toBe(0);
    // 下3行(18個)が消え、上のブロックが落下している
    expect(snapshot.blocks.length).toBeLessThanOrEqual(before - 18 + 0);
    const burst = events.find((e) => e.type === "blocksCleared" && e.cause === "burst");
    expect(burst).toBeDefined();
  });

  it("ブロック消去でゲージが溜まる", () => {
    const game = newGame();
    startPlaying(game);
    const target = coreBlocks(game)[0]!;
    typePhrase(game, target.readingKana);
    game.advance(2000);
    expect(game.getSnapshot().player.gauge).toBeGreaterThan(0);
  });
});

describe("新規行の落下(v3)", () => {
  it("新しいブロックは各列の山の上に積まれ、既存ブロックは動かない", () => {
    const game = newGame();
    startPlaying(game);
    const before = coreBlocks(game).map((b) => ({ id: b.id, row: b.row, col: b.col }));
    const events: GameEvent[] = [];
    for (let i = 0; i < 60; i++) {
      events.push(...game.advance(100)); // 6秒(初回間隔5.5秒)
    }
    expect(events.some((e) => e.type === "rowDropped")).toBe(true);
    const after = coreBlocks(game);
    expect(after).toHaveLength(42);
    // 既存ブロックの位置は不変
    for (const prev of before) {
      const now = after.find((b) => b.id === prev.id);
      expect(now).toBeDefined();
      expect(now!.row).toBe(prev.row);
      expect(now!.col).toBe(prev.col);
    }
    // 新ブロックは各列の7段目(row 6)に載る
    const added = after.filter((b) => !before.some((p) => p.id === b.id));
    expect(added).toHaveLength(6);
    for (const b of added) {
      expect(b.row).toBe(6);
    }
  });
});

describe("選択キャンセル(v3)", () => {
  it("Escキャンセルでロックと入力バッファが解除され、ミス扱いにならない", () => {
    const game = newGame();
    startPlaying(game);
    const target = coreBlocks(game)[0]!;
    const romaji = new TypingAutomaton(target.readingKana).getCanonicalRomaji();
    // 途中まで入力
    const events: GameEvent[] = [];
    for (const key of romaji.slice(0, 4)) {
      events.push(...game.feedKey(key));
    }
    expect(game.getSnapshot().player.typedRomaji.length).toBe(4);
    const cancelEvents = game.cancelSelection();
    expect(cancelEvents.some((e) => e.type === "selectionCancelled")).toBe(true);
    const s = game.getSnapshot().player;
    expect(s.lockedBlockId).toBeNull();
    expect(s.candidateBlockIds).toHaveLength(0);
    expect(s.typedRomaji).toBe("");
    expect(s.accuracy).toBe(1); // キャンセルはミスではない
  });
});

describe("ALL CLEAR(v3)", () => {
  it("全消しでボーナスとゲージ回復、次の行がすぐ降る", () => {
    const game = newGame();
    startPlaying(game);
    const trigger = block(1, 0, "fire", 2);
    setBoard(game, [block(0, 0, "fire", 3), block(0, 1, "fire", 4), trigger]);
    const scoreBefore = game.getSnapshot().player.score;
    typePhrase(game, trigger.readingKana);
    const events = game.advance(1000);
    const allClear = events.find((e) => e.type === "allClear");
    expect(allClear).toBeDefined();
    const s = game.getSnapshot().player;
    expect(s.score).toBeGreaterThanOrEqual(scoreBefore + 5000);
    expect(s.gauge).toBeGreaterThanOrEqual(0.5);
    // 全消し後は600ms以内に次の行が降ってくる
    const dropEvents = game.advance(700);
    expect(dropEvents.some((e) => e.type === "rowDropped")).toBe(true);
  });
});

describe("レベルアップ(v3)", () => {
  it("30秒生存でレベル2になりボーナスが入る", () => {
    const game = newGame();
    startPlaying(game);
    setBoard(game, []); // 盤面を空にして長く生存させる
    const events: GameEvent[] = [];
    for (let i = 0; i < 320; i++) {
      events.push(...game.advance(100)); // 32秒
    }
    const levelUp = events.find((e) => e.type === "levelUp");
    expect(levelUp).toBeDefined();
    if (levelUp?.type === "levelUp") {
      expect(levelUp.level).toBe(2);
      expect(levelUp.bonus).toBeGreaterThan(0);
    }
    expect(game.getSnapshot().mode === "survival" && game.getSnapshot().level).toBe(2);
  });
});

describe("難易度(D-032, D-033, D-039, D-040)", () => {
  it("行上昇の速さは難易度に関わらず共通(易しい難易度でも無限に生存できてしまわないように)", () => {
    const easy = new SurvivalGame("diff-easy", PHRASES, GARBAGE_PHRASES, "easy");
    const normal = new SurvivalGame("diff-normal", PHRASES, GARBAGE_PHRASES, "normal");
    const hard = new SurvivalGame("diff-hard", PHRASES, GARBAGE_PHRASES, "hard");
    startPlaying(easy);
    startPlaying(normal);
    startPlaying(hard);
    easy.advance(20_000);
    normal.advance(20_000);
    hard.advance(20_000);
    const easyInterval = easy.getCore().currentRiseInterval();
    const normalInterval = normal.getCore().currentRiseInterval();
    const hardInterval = hard.getCore().currentRiseInterval();
    expect(easyInterval).toBe(normalInterval);
    expect(normalInterval).toBe(hardInterval);
  });

  it("easyはほぼ全てmicro tier(単語レベル)の文章になる(D-040: 寿司打を参考にした短さ)", () => {
    const game = new SurvivalGame("diff-easy-micro", PHRASES, GARBAGE_PHRASES, "easy");
    const core = game.getCore() as unknown as { blocks: Block[]; dropRow: () => void };
    let microCount = 0;
    let total = 0;
    for (let i = 0; i < 100; i++) {
      core.dropRow();
      for (const b of core.blocks) {
        if (b.kind !== "normal") continue;
        const phrase = PHRASES.find((p) => p.id === b.phraseId);
        if (!phrase) continue;
        total += 1;
        if (phrase.tier === "micro") microCount += 1;
      }
      core.blocks = [];
    }
    expect(microCount / total).toBeGreaterThan(0.6);
  });

  it("easyは短い文章、hardは長い文章が多く出現する(行上昇の速さは変えず、文章の長さで難易度差をつける)", () => {
    const tierWeight: Record<string, number> = { micro: 1, short: 2, standard: 3, long: 4 };

    function averageTierWeight(difficulty: "easy" | "normal" | "hard"): number {
      const game = new SurvivalGame(`diff-tier-${difficulty}`, PHRASES, GARBAGE_PHRASES, difficulty);
      const core = game.getCore() as unknown as { blocks: Block[]; dropRow: () => void };
      let weightSum = 0;
      let total = 0;
      for (let i = 0; i < 100; i++) {
        core.dropRow();
        for (const b of core.blocks) {
          if (b.kind !== "normal") continue;
          const phrase = PHRASES.find((p) => p.id === b.phraseId);
          if (!phrase) continue;
          total += 1;
          weightSum += tierWeight[phrase.tier] ?? 0;
        }
        core.blocks = [];
      }
      return weightSum / total;
    }

    const easy = averageTierWeight("easy");
    const normal = averageTierWeight("normal");
    const hard = averageTierWeight("hard");

    // 平均的な文章の長さ(tierの重み)は easy < normal < hard の順になる
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
  });

  it("getSummaryが選択した難易度を返す", () => {
    const game = new SurvivalGame("diff-summary", PHRASES, GARBAGE_PHRASES, "hard");
    startPlaying(game);
    expect(game.getSummary().difficulty).toBe("hard");
  });

  it("難易度未指定時はnormal相当で動作する(後方互換)", () => {
    const game = new SurvivalGame("diff-default", PHRASES, GARBAGE_PHRASES);
    startPlaying(game);
    expect(game.getSummary().difficulty).toBe("normal");
  });
});

describe("大連鎖スローモー(D-051)", () => {
  function setResolving(game: SurvivalGame, resolving: Record<string, unknown>): void {
    (game.getCore() as unknown as { resolving: unknown }).resolving = resolving;
  }

  it("拡張ヒットストップの長さは深さに応じて伸び、上限で頭打ちになる", () => {
    const core = newGame("hitstop-calc").getCore() as unknown as {
      bigChainHitStopMs: (depth: number) => number;
    };
    expect(core.bigChainHitStopMs(5)).toBe(260);
    expect(core.bigChainHitStopMs(6)).toBe(300);
    expect(core.bigChainHitStopMs(10)).toBe(260 + 5 * 40);
    expect(core.bigChainHitStopMs(20)).toBe(500); // 上限で頭打ち
  });

  it("5連鎖に到達すると即座には確定させず、拡張ヒットストップの間だけ待ってから確定する", () => {
    const game = newGame("big-chain-hitstop");
    startPlaying(game);
    setBoard(game, [
      block(0, 0, "fire", 2),
      block(0, 1, "fire", 3),
      block(1, 0, "fire", 4),
      block(1, 1, "fire", 5),
    ]);
    // 「falling ステージ・現在4連鎖目」から続きを再現する(実際の多段カスケードを手で
    // 組む代わりに、他のテストと同様 resolving state を直接差し替える手法を使う)
    setResolving(game, {
      stage: "falling",
      stageMsLeft: 0,
      chainDepth: 4,
      clearingBlocks: [],
      largestGroupSize: 0,
      cause: "auto",
      fromBurst: false,
      coloredCleared: 0,
      garbageDestroyed: 0,
      maxGroupSize: 4,
    });

    // 5連鎖目に入るが、拡張ヒットストップ(260ms)の間はまだ blocksCleared が来ない
    const events1 = game.advance(10);
    expect(events1.some((e) => e.type === "blocksCleared")).toBe(false);
    expect(game.getSnapshot().player.bigChainImpact).toBe(true);

    const events2 = game.advance(200); // 合計210ms、まだ260ms未満
    expect(events2.some((e) => e.type === "blocksCleared")).toBe(false);

    const events3 = game.advance(100); // 合計310ms > 260ms
    const clear = events3.find((e) => e.type === "blocksCleared");
    expect(clear).toBeDefined();
    if (clear?.type === "blocksCleared") {
      expect(clear.chain).toBe(5);
    }
    expect(game.getSnapshot().player.bigChainImpact).toBe(false);
  });
});

describe("フィーバータイム(D-052)", () => {
  function setResolving(game: SurvivalGame, resolving: Record<string, unknown>): void {
    (game.getCore() as unknown as { resolving: unknown }).resolving = resolving;
  }

  it("6連鎖以上を達成するとフィーバーが開始し、スコア倍率がかかる", () => {
    const game = newGame("fever-trigger");
    startPlaying(game);
    setBoard(game, [
      block(0, 0, "fire", 2),
      block(0, 1, "fire", 3),
      block(1, 0, "fire", 4),
      block(1, 1, "fire", 5),
    ]);
    setResolving(game, {
      stage: "falling",
      stageMsLeft: 0,
      chainDepth: 5,
      clearingBlocks: [],
      largestGroupSize: 0,
      cause: "auto",
      fromBurst: false,
      coloredCleared: 0,
      garbageDestroyed: 0,
      maxGroupSize: 5,
    });

    expect(game.getSnapshot().player.feverActive).toBe(false);
    const events = game.advance(1000); // 拡張ヒットストップ+clearing+fallingを消化するのに十分
    expect(events.some((e) => e.type === "feverStarted")).toBe(true);
    const finished = events.find((e) => e.type === "chainFinished");
    expect(finished?.type === "chainFinished" && finished.depth).toBe(6);
    expect(game.getSnapshot().player.feverActive).toBe(true);
    expect(game.getSnapshot().player.feverMsLeft).toBe(8000);
  });

  it("フィーバー中は打鍵の得点がscoreMultiplier倍になる", () => {
    const game = newGame("fever-score");
    startPlaying(game);
    const core = game.getCore();

    const trigger = block(0, 0, "fire", 2);
    setBoard(game, [trigger]);
    const key1 = new TypingAutomaton(trigger.readingKana).getCanonicalRomaji().charAt(0);
    const before1 = game.getSnapshot().player.score;
    game.feedKey(key1);
    expect(game.getSnapshot().player.score - before1).toBe(10); // score.perCorrectKey

    const trigger2 = block(0, 0, "fire", 3);
    setBoard(game, [trigger2]);
    (core as unknown as { feverMsLeft: number }).feverMsLeft = 8000;
    const key2 = new TypingAutomaton(trigger2.readingKana).getCanonicalRomaji().charAt(0);
    const before2 = game.getSnapshot().player.score;
    game.feedKey(key2);
    expect(game.getSnapshot().player.score - before2).toBe(20); // 2倍
  });

  it("フィーバーは残り時間が0になると自動終了しfeverEndedを発火する", () => {
    const game = newGame("fever-end");
    startPlaying(game);
    const core = game.getCore();
    (core as unknown as { feverMsLeft: number }).feverMsLeft = 500;
    expect(game.getSnapshot().player.feverActive).toBe(true);

    const events = game.advance(500);
    expect(events.some((e) => e.type === "feverEnded")).toBe(true);
    expect(game.getSnapshot().player.feverActive).toBe(false);
    expect(game.getSnapshot().player.feverMsLeft).toBe(0);
  });
});

describe("決定論", () => {
  it("同じSeedと同じ操作列から同じ結果になる", () => {
    const script = "shiryouwokakuninsuruhonwoyomimasuasupiko";
    const run = () => {
      const game = newGame("replay-2");
      game.advance(3000);
      for (const key of script) {
        game.feedKey(key);
        game.advance(50);
      }
      game.advance(120000);
      return JSON.stringify(game.getSummary());
    };
    expect(run()).toBe(run());
  });
});

describe("タイピング分析(D-048)", () => {
  it("正しい打鍵とミスを記録し、キーごとのミス率を計算する", () => {
    const game = newGame("analysis-1");
    startPlaying(game);
    const trigger = block(1, 0, "fire", 2);
    setBoard(game, [trigger]);
    const romaji = new TypingAutomaton(trigger.readingKana).getCanonicalRomaji();
    const firstKey = romaji.charAt(0);
    const wrongKey = firstKey === "z" ? "q" : "z";

    game.feedKey(wrongKey);
    for (const key of romaji) game.feedKey(key);

    const analysis = game.getSummary().analysis;
    expect(analysis.totalKeystrokes).toBe(romaji.length + 1);
    expect(analysis.correctKeystrokes).toBe(romaji.length);
    expect(analysis.incorrectKeystrokes).toBe(1);
    expect(analysis.accuracy).toBeCloseTo(romaji.length / (romaji.length + 1));

    const wrongStat = analysis.keyStats.find((k) => k.key === wrongKey);
    expect(wrongStat).toBeDefined();
    expect(wrongStat!.incorrect).toBe(1);
    expect(wrongStat!.missRate).toBe(1);
  });

  it("正解キー間の平均間隔(打鍵ペース)を計算する", () => {
    const game = newGame("analysis-2");
    startPlaying(game);
    const trigger = block(1, 0, "fire", 3);
    setBoard(game, [trigger]);
    const romaji = new TypingAutomaton(trigger.readingKana).getCanonicalRomaji();

    for (const key of romaji) {
      game.advance(100);
      game.feedKey(key);
    }

    const analysis = game.getSummary().analysis;
    expect(analysis.averageIntervalMs).toBeGreaterThan(0);
    expect(analysis.averageIntervalMs).toBeCloseTo(100, -1);
  });

  it("試行回数が少ないキーはweakKeysの対象から除外される", () => {
    const game = newGame("analysis-3");
    startPlaying(game);
    const trigger = block(1, 0, "fire", 4);
    setBoard(game, [trigger]);
    const romaji = new TypingAutomaton(trigger.readingKana).getCanonicalRomaji();
    const firstKey = romaji.charAt(0);
    const wrongKey = firstKey === "z" ? "q" : "z";

    // 1回だけミスさせる(閾値未満なのでweakKeysには出ない想定)
    game.feedKey(wrongKey);
    for (const key of romaji) game.feedKey(key);

    const analysis = game.getSummary().analysis;
    expect(analysis.weakKeys.find((k) => k.key === wrongKey)).toBeUndefined();
  });

  it("一度もミスしていないキーはweakKeysに含まれない(D-049)", () => {
    const game = newGame("analysis-no-miss");
    startPlaying(game);
    const trigger = block(1, 0, "fire", 5);
    setBoard(game, [trigger]);
    const romaji = new TypingAutomaton(trigger.readingKana).getCanonicalRomaji();

    // 一度もミスせず正解のみで打鍵回数を稼ぐ(試行回数の閾値は満たすがミスはゼロ)
    for (const key of romaji) game.feedKey(key);

    const analysis = game.getSummary().analysis;
    for (const k of analysis.weakKeys) {
      expect(k.incorrect).toBeGreaterThan(0);
    }
  });

  it("手・指ごとのミス統計を正しく集計する(D-049)", () => {
    const game = newGame("analysis-hand");
    startPlaying(game);
    setBoard(game, []); // 盤面を空にして全キーを確実にミスさせる
    game.feedKey("q"); // left-pinky
    game.feedKey("q"); // left-pinky
    game.feedKey("p"); // right-pinky

    const analysis = game.getSummary().analysis;
    const leftHand = analysis.handStats.find((h) => h.hand === "left")!;
    const rightHand = analysis.handStats.find((h) => h.hand === "right")!;
    expect(leftHand.incorrect).toBe(2);
    expect(rightHand.incorrect).toBe(1);

    const leftPinky = analysis.fingerStats.find((f) => f.finger === "left-pinky")!;
    expect(leftPinky.incorrect).toBe(2);
    expect(leftPinky.missRate).toBe(1);
    const rightPinky = analysis.fingerStats.find((f) => f.finger === "right-pinky")!;
    expect(rightPinky.incorrect).toBe(1);
    // 押されていない指も0件のまま結果に含まれる
    const rightMiddle = analysis.fingerStats.find((f) => f.finger === "right-middle")!;
    expect(rightMiddle.correct + rightMiddle.incorrect).toBe(0);
  });

  it("前半・後半の打鍵統計を経過時間の中間点で分割する(D-049)", () => {
    const game = newGame("analysis-segment");
    startPlaying(game);
    setBoard(game, []);
    game.feedKey("q"); // atMs=0
    game.advance(1000);
    game.feedKey("p"); // atMs=1000

    const analysis = game.getSummary().analysis;
    expect(analysis.firstHalf.keystrokes).toBe(1);
    expect(analysis.secondHalf.keystrokes).toBe(1);
    expect(analysis.firstHalf.keystrokes + analysis.secondHalf.keystrokes).toBe(
      analysis.totalKeystrokes,
    );
  });
});

describe("語彙テーマ選択(D-053)", () => {
  const difficulties = ["easy", "normal", "hard"] as const;

  for (const themeDef of VOCAB_THEMES) {
    for (const difficulty of difficulties) {
      it(`テーマ「${themeDef.label}」× 難易度「${difficulty}」はクラッシュせず健全なプールで開始できる`, () => {
        const pool = buildThemedPhrasePool(themeDef.id, PHRASES);
        // PlayerCoreのコンストラクタは有効フレーズ<10で例外を投げるため、
        // ここで十分に大きいことを確認してから実際にゲームを生成する
        expect(pool.length).toBeGreaterThanOrEqual(30);

        expect(() => {
          const game = new SurvivalGame(`theme-${themeDef.id}-${difficulty}`, pool, GARBAGE_PHRASES, difficulty);
          startPlaying(game);
          game.advance(15_000);
        }).not.toThrow();
      });
    }
  }

  it("テーマを切り替えても同じSeed・同じ操作列なら同じ結果になる(決定性を壊さない)", () => {
    const poolA = buildThemedPhrasePool("business", PHRASES);
    const gameA = new SurvivalGame("theme-determinism", poolA, GARBAGE_PHRASES, "normal");
    const gameB = new SurvivalGame("theme-determinism", poolA, GARBAGE_PHRASES, "normal");
    startPlaying(gameA);
    startPlaying(gameB);
    gameA.advance(5000);
    gameB.advance(5000);
    expect(gameA.getSnapshot().player.score).toBe(gameB.getSnapshot().player.score);
    expect(coreBlocks(gameA)).toEqual(coreBlocks(gameB));
  });
});
