import { segmentKana } from "./segment";
import { TypingAutomaton } from "./automaton";

export interface RomajiCandidateOptions {
  /** 返す候補の最大件数。組み合わせ爆発を防ぐため必ず上限を持つ。 */
  maxCandidates?: number;
}

export interface RomajiCandidateResult {
  /** segmentKana が正規化した読み仮名 */
  normalizedReading: string;
  /** 標準候補から順に並んだ、TYPE BURSTで受理される候補 */
  candidates: string[];
  /** 上限を超える候補が存在し、候補を省略したか */
  truncated: boolean;
}

const DEFAULT_MAX_CANDIDATES = 8;

function accepts(reading: string, candidate: string): boolean {
  const automaton = new TypingAutomaton(reading);
  for (const key of candidate) {
    if (!automaton.feed(key).accepted) return false;
  }
  return automaton.isAccepted();
}

/**
 * TYPE BURSTの入力エンジンが受理するローマ字候補を、標準表記順に上限付きで列挙する。
 *
 * segmentKanaの候補を組み合わせるだけでなく、最終候補をTypingAutomatonで検証する。
 * 将来セグメント境界や文脈ルールが変わっても、ラボと本編の判定がずれないようにするためである。
 */
export function enumerateRomajiCandidates(
  reading: string,
  options: RomajiCandidateOptions = {},
): RomajiCandidateResult {
  const maxCandidates = Math.max(1, Math.floor(options.maxCandidates ?? DEFAULT_MAX_CANDIDATES));
  const segments = segmentKana(reading);
  const normalizedReading = segments.map((segment) => segment.kana).join("");
  const candidates: string[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const visit = (segmentIndex: number, value: string): void => {
    if (truncated) return;
    if (segmentIndex >= segments.length) {
      if (!seen.has(value) && accepts(normalizedReading, value)) {
        if (candidates.length >= maxCandidates) {
          truncated = true;
          return;
        }
        seen.add(value);
        candidates.push(value);
      }
      return;
    }

    const segment = segments[segmentIndex];
    if (!segment) return;
    for (const alternative of segment.alternatives) {
      visit(segmentIndex + 1, value + alternative);
      if (truncated) return;
    }
  };

  visit(0, "");
  return { normalizedReading, candidates, truncated };
}
