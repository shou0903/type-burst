import { describe, expect, it } from "vitest";
import { chainOpportunityHint } from "./chainOpportunity";

const snapshot = (): Parameters<typeof chainOpportunityHint>[0] => ({
  resolving: false, typedRomaji: "",
  blocks: [1, 2].map(id => ({ id, kind: "normal", attribute: "fire", displayText: `言葉${id}`, row: 0, col: id, state: "idle", progress: 0 })),
  chainPreviews: [1, 2].map(blockId => ({ blockId, kind: "normal", attribute: "fire", row: 0, col: blockId, predictedDepth: blockId + 2, directGroupSize: 3, predictedClearedCount: 10 })),
});
describe("tactical chain hint", () => {
  it("recommends the highest real candidate without changing the board", () => {
    const player = snapshot()!;
    const original = JSON.stringify(player);
    expect(chainOpportunityHint(player)).toEqual({ title: "4連鎖予測 · 10個消去", detail: "起点「言葉2」" });
    expect(JSON.stringify(player)).toBe(original);
  });
  it("does not advertise stale or clearing blocks", () => {
    const player = snapshot()!;
    player.blocks = [player.blocks[0]!];
    expect(chainOpportunityHint(player)?.detail).toBe("起点「言葉1」");
    player.blocks[0]!.state = "clearing";
    expect(chainOpportunityHint(player)).toBeNull();
  });
  it("keeps focus on the typed word and suspends suggestions during resolution", () => {
    const player = snapshot()!;
    player.typedRomaji = "ko";
    expect(chainOpportunityHint(player)?.title).toBe("入力中の言葉に集中");
    player.resolving = true;
    expect(chainOpportunityHint(player)?.title).toBe("連鎖を解決中");
    expect(chainOpportunityHint(null)).toBeNull();
  });
});
