import { describe, expect, it } from "vitest";
import {
  applyGravity,
  findAutoGroups,
  findGroup,
  highestRow,
} from "@type-blast/game-core";
import type { Attribute, Block } from "@type-blast/game-core";

let idCounter = 0;
function block(row: number, col: number, attribute: Attribute | null): Block {
  idCounter += 1;
  return {
    id: idCounter,
    kind: attribute === null ? "garbage" : "normal",
    attribute,
    phraseId: `p${idCounter}`,
    displayText: "テスト",
    readingKana: "てすと",
    row,
    col,
  };
}

describe("findGroup", () => {
  it("上下左右の同属性を連結する(斜めは含めない)", () => {
    const a = block(0, 0, "fire");
    const b = block(0, 1, "fire");
    const c = block(1, 0, "fire");
    const diagonal = block(1, 1, "fire");
    const other = block(0, 2, "water");
    const blocks = [a, b, c, diagonal, other];
    const group = findGroup(blocks, a, 6, 12);
    // 斜め (1,1) も b・c 経由で連結されるので4個になる
    expect(group.map((g) => g.id).sort()).toEqual([a.id, b.id, c.id, diagonal.id].sort());
  });

  it("孤立ブロックは自分だけを返す", () => {
    const a = block(0, 0, "fire");
    const b = block(0, 2, "fire");
    expect(findGroup([a, b], a, 6, 12)).toHaveLength(1);
  });
});

describe("applyGravity", () => {
  it("空マスの上のブロックが落下する", () => {
    const low = block(0, 0, "fire");
    const floating = block(3, 0, "water");
    const blocks = [low, floating];
    const moves = applyGravity(blocks, 6);
    expect(moves).toEqual([{ id: floating.id, fromRow: 3, toRow: 1 }]);
    expect(floating.row).toBe(1);
  });
});

describe("findAutoGroups", () => {
  it("4個以上のグループのみ検出する", () => {
    const g4 = [
      block(0, 0, "wind"),
      block(0, 1, "wind"),
      block(1, 0, "wind"),
      block(1, 1, "wind"),
    ];
    const g3 = [block(0, 3, "fire"), block(0, 4, "fire"), block(1, 3, "fire")];
    const groups = findAutoGroups([...g4, ...g3], 4, 6, 12);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(4);
  });

  it("妨害ブロック(無属性)はグループに含めない", () => {
    const blocks = [
      block(0, 0, "wind"),
      block(0, 1, "wind"),
      block(1, 0, "wind"),
      block(1, 1, null),
    ];
    expect(findAutoGroups(blocks, 4, 6, 12)).toHaveLength(0);
  });
});

describe("highestRow", () => {
  it("最高到達行を返す", () => {
    expect(highestRow([block(0, 0, "fire"), block(7, 2, "water")])).toBe(7);
    expect(highestRow([])).toBe(-1);
  });
});
