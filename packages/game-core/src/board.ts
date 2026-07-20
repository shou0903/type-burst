import type { Block } from "./types";

/** [row][col] のグリッドを作る。空マスは null */
export function toGrid(
  blocks: readonly Block[],
  columns: number,
  rows: number,
): (Block | null)[][] {
  const grid: (Block | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    grid.push(new Array<Block | null>(columns).fill(null));
  }
  for (const block of blocks) {
    if (block.row >= 0 && block.row < rows && block.col >= 0 && block.col < columns) {
      grid[block.row]![block.col] = block;
    }
  }
  return grid;
}

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * 起点ブロックと上下左右で連結する同属性グループを返す(斜めは含めない)。
 * 妨害ブロック(無属性)はグループに含めない。
 */
export function findGroup(
  blocks: readonly Block[],
  origin: Block,
  columns: number,
  rows: number,
): Block[] {
  if (origin.attribute === null) return [origin];
  const grid = toGrid(blocks, columns, rows);
  const visited = new Set<number>();
  const group: Block[] = [];
  const stack: Block[] = [origin];
  visited.add(origin.id);
  while (stack.length > 0) {
    const current = stack.pop()!;
    group.push(current);
    for (const [dr, dc] of DIRECTIONS) {
      const next = grid[current.row + dr]?.[current.col + dc];
      if (next && !visited.has(next.id) && next.attribute === origin.attribute) {
        visited.add(next.id);
        stack.push(next);
      }
    }
  }
  return group;
}

/** minSize 以上の同属性連結グループを全て返す(自動連鎖用) */
export function findAutoGroups(
  blocks: readonly Block[],
  minSize: number,
  columns: number,
  rows: number,
): Block[][] {
  const visited = new Set<number>();
  const groups: Block[][] = [];
  for (const block of blocks) {
    if (block.attribute === null || visited.has(block.id)) continue;
    const group = findGroup(blocks, block, columns, rows);
    for (const b of group) visited.add(b.id);
    if (group.length >= minSize) {
      groups.push(group);
    }
  }
  return groups;
}

/** 消去対象に隣接する妨害ブロックを返す */
export function findAdjacentGarbage(
  blocks: readonly Block[],
  cleared: readonly Block[],
  columns: number,
  rows: number,
): Block[] {
  const grid = toGrid(blocks, columns, rows);
  const clearedIds = new Set(cleared.map((b) => b.id));
  const hit = new Map<number, Block>();
  for (const block of cleared) {
    for (const [dr, dc] of DIRECTIONS) {
      const next = grid[block.row + dr]?.[block.col + dc];
      if (next && next.kind === "garbage" && !clearedIds.has(next.id)) {
        hit.set(next.id, next);
      }
    }
  }
  return [...hit.values()];
}

export interface FallMove {
  id: number;
  fromRow: number;
  toRow: number;
}

/** 重力落下。blocks の row を書き換え、移動したブロックの一覧を返す */
export function applyGravity(blocks: Block[], columns: number): FallMove[] {
  const moves: FallMove[] = [];
  for (let col = 0; col < columns; col++) {
    const column = blocks
      .filter((b) => b.col === col)
      .sort((a, b) => a.row - b.row);
    let target = 0;
    for (const block of column) {
      if (block.row !== target) {
        moves.push({ id: block.id, fromRow: block.row, toRow: target });
        block.row = target;
      }
      target += 1;
    }
  }
  return moves;
}

/** 盤面内の最高到達行(ブロックなしなら -1) */
export function highestRow(blocks: readonly Block[]): number {
  let max = -1;
  for (const block of blocks) {
    if (block.row > max) max = block.row;
  }
  return max;
}
