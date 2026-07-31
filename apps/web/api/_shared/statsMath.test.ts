import { describe, expect, it } from "vitest";
import { histogram, summarize } from "./statsMath";

describe("summarize", () => {
  it("空配列は null を返す", () => {
    expect(summarize([])).toBeNull();
  });

  it("奇数個の中央値は真ん中の値", () => {
    const result = summarize([5, 1, 3]);
    expect(result).toEqual({ count: 3, min: 1, max: 5, avg: 3, median: 3 });
  });

  it("偶数個の中央値は中央2つの平均", () => {
    const result = summarize([1, 2, 3, 4]);
    expect(result?.median).toBe(2.5);
    expect(result?.avg).toBe(2.5);
  });

  it("単一要素", () => {
    expect(summarize([42])).toEqual({ count: 1, min: 42, max: 42, avg: 42, median: 42 });
  });

  it("入力配列を破壊しない", () => {
    const input = [3, 1, 2];
    summarize(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("histogram", () => {
  it("空配列は空配列を返す", () => {
    expect(histogram([], 10)).toEqual([]);
  });

  it("bucketCountが0以下なら空配列", () => {
    expect(histogram([1, 2, 3], 0)).toEqual([]);
  });

  it("全て同じ値なら単一バケットに集約する", () => {
    expect(histogram([5, 5, 5], 10)).toEqual([{ rangeStart: 5, rangeEnd: 5, count: 3 }]);
  });

  it("値を指定バケット数へ均等に分配する", () => {
    const buckets = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
    expect(buckets).toHaveLength(5);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(10);
    // 単調増加する値は各バケットへ均等(2件ずつ)に入るはず
    expect(buckets.every((b) => b.count === 2)).toBe(true);
  });

  it("最大値は最後のバケットに含まれる(境界の丸め誤差で漏れない)", () => {
    const buckets = histogram([0, 100], 10);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(2);
    expect(buckets[buckets.length - 1]!.count).toBeGreaterThanOrEqual(1);
  });
});
