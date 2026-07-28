import { PHRASES, type JapanesePhrase } from "@type-burst/phrase-content";
import { TypingAutomaton } from "@type-burst/typing-engine";

export type WeakKeyPrompt = {
  id: string;
  displayText: string;
  readingKana: string;
  canonicalRomaji: string;
  targetCount: number;
};

export const KEYBOARD_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
] as const;

export function normalizeTargetKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[a-z]$/.test(normalized) ? normalized : "";
}

export function countKey(text: string, key: string): number {
  const normalized = normalizeTargetKey(key);
  if (!normalized) return 0;
  return [...text.toLowerCase()].filter((character) => character === normalized).length;
}

export function buildWeakKeyPrompts(
  key: string,
  phrases: readonly JapanesePhrase[] = PHRASES,
): WeakKeyPrompt[] {
  const normalized = normalizeTargetKey(key);
  if (!normalized) return [];
  return buildWeakKeyPromptMap(phrases).get(normalized) ?? [];
}

export function buildWeakKeyPromptMap(
  phrases: readonly JapanesePhrase[] = PHRASES,
): Map<string, WeakKeyPrompt[]> {
  const promptMap = new Map<string, WeakKeyPrompt[]>();
  for (const row of KEYBOARD_ROWS) {
    for (const key of row) promptMap.set(key, []);
  }

  for (const phrase of phrases) {
    if (!phrase.enabled || phrase.tier === "long") continue;
    const canonicalRomaji = new TypingAutomaton(phrase.readingKana).getCanonicalRomaji();
    for (const key of new Set(canonicalRomaji.match(/[a-z]/g) ?? [])) {
      const prompts = promptMap.get(key);
      if (!prompts) continue;
      prompts.push({
        id: phrase.id,
        displayText: phrase.displayText,
        readingKana: phrase.readingKana,
        canonicalRomaji,
        targetCount: 0,
      });
    }
  }

  for (const [key, prompts] of promptMap) {
    for (const prompt of prompts) prompt.targetCount = countKey(prompt.canonicalRomaji, key);
    prompts.sort((left, right) => {
      if (right.targetCount !== left.targetCount) return right.targetCount - left.targetCount;
      if (left.canonicalRomaji.length !== right.canonicalRomaji.length) {
        return left.canonicalRomaji.length - right.canonicalRomaji.length;
      }
      return left.id.localeCompare(right.id, "ja");
    });
  }
  return promptMap;
}
