import type { GameEvent, BurstTier } from "@type-burst/game-core";

/**
 * 通常サバイバルの開始前に選ぶ、今回の一つだけの目標。
 *
 * FOCUS はプレイ中のスコア計算やゲーム状態を変更しない。GameEvent を
 * 純粋に読むだけなので、結果画面やHUDへ安全に表示できる。
 */
export type FocusGoalId = "perfect-streak" | "chain-4" | "power-burst";

export interface FocusGoalDefinition {
  id: FocusGoalId;
  label: string;
  title: string;
  description: string;
  target: number;
}

export const FOCUS_GOALS: readonly FocusGoalDefinition[] = [
  {
    id: "perfect-streak",
    label: "精度",
    title: "PERFECTを3連続",
    description: "ミスなしで3つの単語を続けて打ち切る",
    target: 3,
  },
  {
    id: "chain-4",
    label: "連鎖",
    title: "4 CHAINを1回",
    description: "4段以上の連鎖を一度つなげる",
    target: 4,
  },
  {
    id: "power-burst",
    label: "バースト",
    title: "POWER以上を1回発動",
    description: "POWERまたはMAX BURSTを一度発動する",
    target: 1,
  },
] as const;

export const DEFAULT_FOCUS_GOAL: FocusGoalId = "perfect-streak";

export interface FocusProgress {
  goal: FocusGoalId;
  /** 目標に対する現在の進捗。0〜targetの範囲に収める。 */
  current: number;
  target: number;
  /** UIの進捗バー用。0〜1。 */
  ratio: number;
  achieved: boolean;
  /** 精度目標の表示用。未達成時は現在の連続PERFECT数。 */
  perfectStreak: number;
  /** 3段階チャレンジ。省略された過去のリザルトも読み込める。 */
  challengeBest?: number;
  challengeStreak?: number;
}

export const FOCUS_STAGES: Record<FocusGoalId, readonly [number, number, number]> = {
  "perfect-streak": [3, 6, 10],
  "chain-4": [4, 6, 8],
  "power-burst": [1, 3, 5],
};

export function focusChallenge(progress: FocusProgress, result = false) {
  const stages = FOCUS_STAGES[progress.goal];
  const best = progress.challengeBest ?? progress.current;
  const level = stages.filter((target) => best >= target).length;
  const target = stages[Math.min(level, 2)]!;
  const current = result || progress.goal !== "perfect-streak"
    ? best : progress.challengeStreak ?? progress.perfectStreak;
  const unit = progress.goal === "perfect-streak" ? "連続PERFECT" : progress.goal === "chain-4" ? "CHAIN" : "回発動";
  return {
    level, best, current, target,
    ratio: level === 3 ? 1 : Math.min(1, current / target),
    medal: ["挑戦中", "BRONZE", "SILVER", "GOLD"][level]!,
    text: level === 3 ? "3段階すべて達成！" : `${current} / ${target} ${unit}`,
    next: level === 3 ? "GOLD COMPLETE" : `次は${["ブロンズ", "シルバー", "ゴールド"][level]}`,
  };
}

function definitionFor(goal: FocusGoalId): FocusGoalDefinition {
  return FOCUS_GOALS.find((candidate) => candidate.id === goal) ?? FOCUS_GOALS[0]!;
}

export function focusGoalDefinition(goal: FocusGoalId): FocusGoalDefinition {
  return definitionFor(goal);
}

/** 通常サバイバルだけが FOCUS の対象。daily/duel/tutorial は必ず false。 */
export function isFocusEligibleMode(modeType: string): modeType is "survival" {
  return modeType === "survival";
}

export function isFocusGoalId(value: unknown): value is FocusGoalId {
  return (
    value === "perfect-streak" || value === "chain-4" || value === "power-burst"
  );
}

export function createFocusProgress(goal: FocusGoalId): FocusProgress {
  const definition = definitionFor(goal);
  return {
    goal,
    current: 0,
    target: definition.target,
    ratio: 0,
    achieved: false,
    perfectStreak: 0,
    challengeBest: 0,
    challengeStreak: 0,
  };
}

/** 目標を同じプレイの途中で巻き戻す必要がある場合の明示的なリセット。 */
export function resetFocusProgress(goal: FocusGoalId): FocusProgress {
  return createFocusProgress(goal);
}

/**
 * 一つのゲームイベントから FOCUS の進捗を決定的に進める。
 * ゲーム本体の score / gauge / fall / ranking は一切参照・変更しない。
 */
export function advanceFocusProgress(
  progress: FocusProgress,
  event: GameEvent,
): FocusProgress {
  let challengeBest = progress.challengeBest ?? progress.current;
  let challengeStreak = progress.challengeStreak ?? progress.perfectStreak;
  const ceiling = FOCUS_STAGES[progress.goal][2];
  if (progress.goal === "perfect-streak" && event.type === "phraseCompleted") {
    challengeStreak = event.perfect ? Math.min(ceiling, challengeStreak + 1) : 0;
    challengeBest = Math.max(challengeBest, challengeStreak);
  } else if (progress.goal === "chain-4" && event.type === "chainFinished") {
    challengeBest = Math.max(challengeBest, Math.min(ceiling, event.depth));
  } else if (progress.goal === "power-burst" && event.type === "burstFired" && isPowerTier(event.tier)) {
    challengeBest = Math.min(ceiling, challengeBest + 1);
  } else {
    return progress;
  }
  const advanced = { ...progress, challengeBest, challengeStreak };
  // 最初の目標は従来通り達成を保持。続けて上位メダルを狙える。
  if (progress.achieved) return advanced;

  let current = progress.current;
  let perfectStreak = progress.perfectStreak;
  let achieved = false;

  switch (progress.goal) {
    case "perfect-streak":
      if (event.type !== "phraseCompleted") return progress;
      perfectStreak = event.perfect ? Math.min(progress.target, perfectStreak + 1) : 0;
      current = perfectStreak;
      achieved = perfectStreak >= progress.target;
      break;
    case "chain-4":
      if (event.type !== "chainFinished" || event.depth < progress.target) return advanced;
      current = progress.target;
      achieved = true;
      break;
    case "power-burst":
      if (event.type !== "burstFired" || !isPowerTier(event.tier)) return progress;
      current = progress.target;
      achieved = true;
      break;
  }

  return {
    ...advanced,
    current,
    ratio: Math.min(1, current / progress.target),
    achieved,
    perfectStreak,
  };
}

function isPowerTier(tier: BurstTier): boolean {
  return tier === "power" || tier === "max";
}

export function focusProgressText(progress: FocusProgress): string {
  if (progress.achieved) return "達成";
  if (progress.goal === "perfect-streak") {
    return `${progress.current}/${progress.target} PERFECT`;
  }
  if (progress.goal === "chain-4") {
    return `${progress.current}/${progress.target} CHAIN`;
  }
  return `${progress.current}/${progress.target} POWER BURST`;
}

/**
 * GameResult に任意で添付する値を安全に取り出すためのガード。
 * GameController/GameResult の既存契約を壊さず、古い結果や daily/duel を無視する。
 */
export function focusProgressFromResult(value: unknown): FocusProgress | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.mode === "string" && !isFocusEligibleMode(record.mode)) return null;
  const candidate = record.focus ?? record.focusProgress;
  if (!candidate || typeof candidate !== "object") return null;
  const progress = candidate as Partial<FocusProgress>;
  if (
    !isFocusGoalId(progress.goal) ||
    typeof progress.current !== "number" ||
    typeof progress.target !== "number" ||
    typeof progress.ratio !== "number" ||
    typeof progress.achieved !== "boolean" ||
    typeof progress.perfectStreak !== "number"
  ) {
    return null;
  }
  const definition = definitionFor(progress.goal);
  for (const value of [progress.challengeBest, progress.challengeStreak]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > FOCUS_STAGES[progress.goal][2])) return null;
  }
  if (
    progress.target !== definition.target ||
    !Number.isFinite(progress.current) ||
    !Number.isFinite(progress.ratio) ||
    !Number.isFinite(progress.perfectStreak) ||
    progress.current < 0 ||
    progress.current > progress.target ||
    progress.ratio < 0 ||
    progress.ratio > 1 ||
    progress.perfectStreak < 0
  ) {
    return null;
  }
  return {
    goal: progress.goal,
    current: progress.current,
    target: progress.target,
    ratio: progress.ratio,
    achieved: progress.achieved,
    perfectStreak: progress.perfectStreak,
    ...(progress.challengeBest === undefined ? {} : { challengeBest: progress.challengeBest }),
    ...(progress.challengeStreak === undefined ? {} : { challengeStreak: progress.challengeStreak }),
  };
}
