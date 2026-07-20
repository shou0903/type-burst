import { segmentKana, type KanaSegment } from "./segment";

export interface FeedResult {
  /** このキーが正しい進捗として受理されたか */
  accepted: boolean;
  /** この入力で文章全体が完成したか */
  completed: boolean;
}

/** NFA の状態: seg 番目のセグメントを prefix まで打った */
interface AutomatonState {
  seg: number;
  prefix: string;
}

/**
 * 読み仮名1件に対するローマ字入力オートマトン。
 * 複数表記(shi/si など)を同時に受理し、確定した経路だけ進む。
 */
export class TypingAutomaton {
  readonly reading: string;
  private readonly segments: KanaSegment[];
  private states: AutomatonState[];
  private typed = "";

  constructor(reading: string) {
    this.reading = reading;
    this.segments = segmentKana(reading);
    if (this.segments.length === 0) {
      throw new Error("typing-engine: 空の読み仮名");
    }
    this.states = this.closure([{ seg: 0, prefix: "" }]);
  }

  reset(): void {
    this.states = this.closure([{ seg: 0, prefix: "" }]);
    this.typed = "";
  }

  clone(): TypingAutomaton {
    const copy = new TypingAutomaton(this.reading);
    copy.states = this.states.map((s) => ({ ...s }));
    copy.typed = this.typed;
    return copy;
  }

  feed(key: string): FeedResult {
    if (key.length !== 1) {
      return { accepted: false, completed: this.isAccepted() };
    }
    const next: AutomatonState[] = [];
    const seen = new Set<string>();
    for (const state of this.states) {
      const segment = this.segments[state.seg];
      if (!segment) continue; // 完了状態
      for (const alt of segment.alternatives) {
        if (
          alt.length > state.prefix.length &&
          alt.startsWith(state.prefix) &&
          alt.charAt(state.prefix.length) === key
        ) {
          const prefix = state.prefix + key;
          const id = `${state.seg}:${prefix}`;
          if (!seen.has(id)) {
            seen.add(id);
            next.push({ seg: state.seg, prefix });
          }
        }
      }
    }
    if (next.length === 0) {
      return { accepted: false, completed: this.isAccepted() };
    }
    this.states = this.closure(next);
    this.typed += key;
    return { accepted: true, completed: this.isAccepted() };
  }

  isAccepted(): boolean {
    return this.states.some((s) => s.seg === this.segments.length);
  }

  /** 0〜1。受理済みキー数と最短残りキー数から算出 */
  getProgress(): number {
    if (this.isAccepted()) return 1;
    const remaining = this.getRemainingRomaji().length;
    const done = this.typed.length;
    if (done + remaining === 0) return 0;
    return done / (done + remaining);
  }

  /** 次に受理できるキーの一覧 */
  getExpectedKeys(): string[] {
    const keys = new Set<string>();
    for (const state of this.states) {
      const segment = this.segments[state.seg];
      if (!segment) continue;
      for (const alt of segment.alternatives) {
        if (alt.length > state.prefix.length && alt.startsWith(state.prefix)) {
          keys.add(alt.charAt(state.prefix.length));
        }
      }
    }
    return [...keys];
  }

  /** これまで受理したキー列 */
  getTypedRomaji(): string {
    return this.typed;
  }

  /** 残りの標準表記ローマ字(ガイド表示用、最短経路) */
  getRemainingRomaji(): string {
    if (this.isAccepted()) return "";
    // 最も進んでいる状態を代表にする
    let best: AutomatonState | null = null;
    for (const state of this.states) {
      if (state.seg >= this.segments.length) continue;
      if (
        best === null ||
        state.seg > best.seg ||
        (state.seg === best.seg && state.prefix.length > best.prefix.length)
      ) {
        best = state;
      }
    }
    if (best === null) return "";
    const segment = this.segments[best.seg];
    if (!segment) return "";
    let current: string | null = null;
    for (const alt of segment.alternatives) {
      if (alt.startsWith(best.prefix)) {
        if (current === null || alt.length < current.length) {
          current = alt;
        }
      }
    }
    let out = current === null ? "" : current.slice(best.prefix.length);
    for (let i = best.seg + 1; i < this.segments.length; i++) {
      const alt = this.segments[i]?.alternatives[0];
      if (alt !== undefined) out += alt;
    }
    return out;
  }

  /** 文章全体の標準表記(未入力時のガイド用) */
  getCanonicalRomaji(): string {
    return this.segments.map((s) => s.alternatives[0] ?? "").join("");
  }

  private closure(states: AutomatonState[]): AutomatonState[] {
    const result: AutomatonState[] = [];
    const seen = new Set<string>();
    const queue = [...states];
    while (queue.length > 0) {
      const state = queue.pop()!;
      const id = `${state.seg}:${state.prefix}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(state);
      const segment = this.segments[state.seg];
      if (segment && segment.alternatives.includes(state.prefix)) {
        queue.push({ seg: state.seg + 1, prefix: "" });
      }
    }
    return result;
  }
}
