import type { PhraseTier } from "@type-burst/phrase-content";
import type { CpuDifficulty, SurvivalDifficulty } from "./types";

/** 行上昇の設定。経過時間とともに加速する */
export interface RiseConfig {
  startIntervalMs: number;
  minIntervalMs: number;
  /** 経過1秒ごとに間隔を縮める量(ms) */
  accelPerSecondMs: number;
  warningMs: number;
}

export interface CpuProfile {
  /** 1分あたりの打鍵数 */
  kpm: number;
  /** 1キーごとのミス率 */
  errorRate: number;
  /** 文章完成後の思考時間(ms) */
  thinkMsMin: number;
  thinkMsMax: number;
  /** ゲージ満タンから発動までの遅延 */
  burstDelayMs: number;
}

/**
 * サバイバル難易度ごとの設定(D-032)。盤面サイズ・出現ロジックは難易度間で
 * 揃え、行上昇の速さのみを変える(初心者でも「同じゲーム」に見えるように)。
 * scoreMultiplier は世界ランキングに送信する際にスコアへ掛ける係数。
 * 易しい難易度ほど同じ操作精度でも高スコアが出やすいため、その分だけ
 * ランキング上のスコアを割り引き、難しい難易度は上乗せする。
 * 実プレイのデータが無い状態での初期値なので、後で実際のスコア分布を見て
 * 調整する前提の暫定値(apps/web/api/scores.ts 側の定数と値を揃えること)。
 */
export interface SurvivalDifficultyProfile {
  rise: RiseConfig;
  scoreMultiplier: number;
}

/** 全チューニング値。ハードコード禁止(設計書 §32) */
export interface GameConfig {
  columns: number;
  visibleRows: number;
  /** 0-indexed。この行以上にブロックがあると危険状態 */
  dangerRow: number;
  initialRows: number;
  countdownMs: number;
  tierRatio: Record<PhraseTier, number>;
  survivalDifficulty: Record<SurvivalDifficulty, SurvivalDifficultyProfile>;
  duelRise: RiseConfig;
  chain: {
    directClearMin: number;
    autoClearMin: number;
    stepMs: number;
    fallMs: number;
    hitStopMs: number;
    maxSteps: number;
  };
  special: {
    /** 新規行の1マスごとの出現率(1行に最大1個) */
    bombChance: number;
    prismChance: number;
    /** TYPE BURST が吹き飛ばす下からの行数 */
    burstRows: number;
    gaugeMax: number;
    gaugePerBlock: number;
    gaugePerChainDepth: number;
    gaugePerPerfect: number;
    burstBaseScore: number;
    /** 全消しボーナス */
    allClearBonus: number;
    allClearGauge: number;
  };
  survivalLevel: {
    /** レベルアップ間隔 */
    intervalMs: number;
    /** レベルアップごとのボーナス点(レベル×この値) */
    bonusPerLevel: number;
  };
  garbage: {
    /** 着弾予告時間 */
    dropDelayMs: number;
    /** 1回の着弾上限 */
    landCapPerDrop: number;
  };
  attack: {
    chainBonus: readonly number[];
    garbageDestroyedWeight: number;
    simultaneousBaseline: number;
    perfectStreakThreshold: number;
    perfectBonus: number;
    garbageDivisor: number;
    sendCap: number;
  };
  score: {
    perCorrectKey: number;
    perColoredBlock: number;
    perGarbageBlock: number;
    perSpecialBlock: number;
    chainSquareWeight: number;
    perPerfectPhrase: number;
  };
  cpu: Record<CpuDifficulty, CpuProfile>;
}

export const DEFAULT_CONFIG: GameConfig = {
  columns: 6,
  visibleRows: 10,
  dangerRow: 8,
  initialRows: 6,
  countdownMs: 3_000,
  tierRatio: { short: 0.2, standard: 0.65, long: 0.15 },
  survivalDifficulty: {
    easy: {
      rise: {
        startIntervalMs: 8_000,
        minIntervalMs: 4_000,
        accelPerSecondMs: 15,
        warningMs: 1_800,
      },
      scoreMultiplier: 0.65,
    },
    normal: {
      rise: {
        startIntervalMs: 5_500,
        minIntervalMs: 2_400,
        accelPerSecondMs: 25,
        warningMs: 1_500,
      },
      scoreMultiplier: 1.0,
    },
    hard: {
      rise: {
        startIntervalMs: 4_200,
        minIntervalMs: 1_700,
        accelPerSecondMs: 32,
        warningMs: 1_200,
      },
      scoreMultiplier: 1.4,
    },
  },
  duelRise: {
    startIntervalMs: 6_000,
    minIntervalMs: 3_200,
    accelPerSecondMs: 18,
    warningMs: 1_500,
  },
  chain: {
    directClearMin: 3,
    autoClearMin: 4,
    stepMs: 150,
    fallMs: 120,
    hitStopMs: 70,
    maxSteps: 32,
  },
  special: {
    bombChance: 0.07,
    prismChance: 0.035,
    burstRows: 3,
    gaugeMax: 100,
    gaugePerBlock: 3,
    gaugePerChainDepth: 7,
    gaugePerPerfect: 6,
    burstBaseScore: 1_000,
    allClearBonus: 5_000,
    allClearGauge: 50,
  },
  survivalLevel: {
    intervalMs: 30_000,
    bonusPerLevel: 300,
  },
  garbage: {
    dropDelayMs: 1_500,
    landCapPerDrop: 18,
  },
  attack: {
    chainBonus: [0, 0, 2, 5, 9, 14, 20, 27, 35, 44],
    garbageDestroyedWeight: 0.5,
    simultaneousBaseline: 3,
    perfectStreakThreshold: 5,
    perfectBonus: 2,
    garbageDivisor: 4,
    sendCap: 18,
  },
  score: {
    perCorrectKey: 10,
    perColoredBlock: 100,
    perGarbageBlock: 120,
    perSpecialBlock: 150,
    chainSquareWeight: 500,
    perPerfectPhrase: 150,
  },
  cpu: {
    easy: { kpm: 120, errorRate: 0.13, thinkMsMin: 1000, thinkMsMax: 1800, burstDelayMs: 4000 },
    normal: { kpm: 220, errorRate: 0.07, thinkMsMin: 550, thinkMsMax: 1100, burstDelayMs: 2500 },
    hard: { kpm: 360, errorRate: 0.035, thinkMsMin: 260, thinkMsMax: 620, burstDelayMs: 1200 },
  },
};
