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
  if (progress.achieved) return progress;

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
      if (event.type !== "chainFinished" || event.depth < progress.target) return progress;
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
    ...progress,
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
  };
}
