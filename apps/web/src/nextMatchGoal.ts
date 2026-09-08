import type { SurvivalDifficulty } from "@type-burst/game-core";
import {
  getStoredResultRuleset,
  SURVIVAL_RULESET,
  type ResultRuleset,
  type StoredResult,
} from "./storage";

export type MatchGoalKind = "accuracy" | "chain" | "score";

/** 次の目標を作るのに必要な、サバイバル結果の共通部分。 */
export type GoalSource = Pick<StoredResult, "score" | "maxChain" | "accuracy" | "difficulty"> & {
  /** 集計の信頼度を表示文に反映するための任意の今回データ。 */
  phraseCount?: number;
  correctKeyCount?: number;
  /** 現在結果は省略時に現行サバイバル(v2)として扱う。 */
  ruleset?: ResultRuleset;
};

export interface MatchGoal {
  kind: MatchGoalKind;
  /** accuracy は 0〜1、chain/score は表示する単位の整数値。 */
  target: number;
  currentValue: number;
  targetText: string;
  reason: string;
}

export interface PreviousMatchGoal {
  goal: MatchGoal;
  achieved: boolean;
}

export interface NextMatchGoal {
  difficulty: SurvivalDifficulty;
  goal: MatchGoal;
  previous: PreviousMatchGoal | null;
}

/**
 * 現在の結果から、優先順位を固定した「次の一つだけの目標」を作る。
 * 正確率 → 連鎖 → スコアの順に判定することで、複数の助言を同時に出さず、
 * 次の一戦で何を意識するかを明確にする。
 */
export function deriveMatchGoal(source: GoalSource): MatchGoal {
  const accuracy = clamp(source.accuracy, 0, 1);
  if (accuracy < 0.95) {
    const target = Math.min(0.95, accuracy + 0.01);
    return {
      kind: "accuracy",
      target,
      currentValue: accuracy,
      targetText: `正確率 ${(target * 100).toFixed(1)}% 以上`,
      reason: "速さを伸ばす前に、まず一文字ずつの正確さを1.0ポイント上げて土台を安定させます。",
    };
  }

  const maxChain = Math.max(0, Math.floor(finiteOrZero(source.maxChain)));
  if (maxChain < 5) {
    const target = maxChain + 1;
    const enoughAccuracyData =
      (source.phraseCount ?? 0) >= 3 || (source.correctKeyCount ?? 0) >= 80;
    return {
      kind: "chain",
      target,
      currentValue: maxChain,
      targetText: `最大連鎖 ${target} 以上`,
      reason: enoughAccuracyData
        ? "正確率が安定しているので、次は盤面の消す順番を意識して連鎖を1つ伸ばします。"
        : "今回はミスが少なかったので、もう少し打鍵を重ねながら盤面の消す順番を意識して連鎖を伸ばします。",
    };
  }

  const score = Math.max(0, Math.floor(finiteOrZero(source.score)));
  const target = Math.max(score + 1, Math.ceil(score * 1.05));
  return {
    kind: "score",
    target,
    currentValue: score,
    targetText: `スコア ${target.toLocaleString()}点以上`,
    reason:
      (source.phraseCount ?? 0) >= 3 || (source.correctKeyCount ?? 0) >= 80
        ? "正確率と連鎖が安定しているので、次は全体のスコアを少なくとも5%伸ばします。"
        : "今回は正確に打てたので、まずは打鍵を重ねてから全体のスコアを5%伸ばします。",
  };
}

/**
 * 現在の結果と、同じ難易度・ルール世代の履歴から次回目標を作る。
 * previousHistory は現在結果を含めず、新しい順で渡す。現在結果かどうかを
 * スコア等の値一致で推測しないため、同じ成績が続いても直前目標を失わない。
 */
export function buildNextMatchGoal(
  current: GoalSource,
  previousHistory: readonly StoredResult[] = [],
): NextMatchGoal {
  const difficulty = normalizeDifficulty(current.difficulty);
  const ruleset = current.ruleset === "survival-v1" ? "survival-v1" : SURVIVAL_RULESET;
  const goal = deriveMatchGoal(current);
  const previous = previousHistory.find(
    (entry) =>
      getStoredResultRuleset(entry) === ruleset &&
      normalizeDifficulty(entry.difficulty) === difficulty,
  );
  const previousGoal = previous ? deriveMatchGoal(previous) : null;

  return {
    difficulty,
    goal,
    previous: previousGoal
      ? { goal: previousGoal, achieved: isMatchGoalAchieved(previousGoal, current) }
      : null,
  };
}

export function isMatchGoalAchieved(goal: MatchGoal, current: GoalSource): boolean {
  if (goal.kind === "accuracy") return finiteOrZero(current.accuracy) >= goal.target;
  if (goal.kind === "chain") return finiteOrZero(current.maxChain) >= goal.target;
  return finiteOrZero(current.score) >= goal.target;
}

function normalizeDifficulty(value: SurvivalDifficulty | undefined): SurvivalDifficulty {
  return value === "easy" || value === "normal" || value === "hard" || value === "god"
    ? value
    : "normal";
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finiteOrZero(value)));
}
