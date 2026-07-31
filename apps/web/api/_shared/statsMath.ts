/**
 * 管理者統計ダッシュボード(D-093)向けの純粋な集計関数。
 * Redisアクセスを含まないため、api/admin/stats.ts から分離してテスト可能にしている。
 */

export interface NumericSummary {
  count: number;
  min: number;
  max: number;
  avg: number;
  median: number;
}

export function summarize(values: readonly number[]): NumericSummary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: sum / sorted.length,
    median,
  };
}

export interface HistogramBucket {
  rangeStart: number;
  rangeEnd: number;
  count: number;
}

/**
 * 値の範囲を bucketCount 等分してヒストグラムを作る。
 * 幅は呼び出し側が決めず、実際のmin/maxから自動算出する(空データや偏った分布でも破綻しない)。
 */
export function histogram(values: readonly number[], bucketCount = 10): HistogramBucket[] {
  if (values.length === 0 || bucketCount <= 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ rangeStart: min, rangeEnd: max, count: values.length }];
  }
  const span = max - min;
  const bucketSize = span / bucketCount;
  const buckets: HistogramBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    rangeStart: min + i * bucketSize,
    rangeEnd: min + (i + 1) * bucketSize,
    count: 0,
  }));
  for (const value of values) {
    const idx = Math.min(bucketCount - 1, Math.floor((value - min) / bucketSize));
    buckets[idx]!.count += 1;
  }
  return buckets;
}
