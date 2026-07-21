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
 * サバイバル難易度ごとの設定(D-032〜D-038)。
 *
 * D-032→D-033の経緯: 最初は行上昇の速さ(RiseConfig)だけを難易度で変えたところ、
 * 易しい難易度では行上昇が十分遅く「積み上がらないまま無限に生存してスコアを
 * 稼げる」状態になってしまった。そこでD-033では行上昇を全難易度共通に固定し、
 * 文章の長さ(tierRatio)だけで難易度を付ける方式に変えた。
 *
 * D-038でさらに修正: 行上昇を完全に共通化した結果、今度は逆に「初級でも文章を
 * 読んで打ち始めるまでの猶予がほぼ無く、初心者には厳しすぎる」という新たな問題が
 * 発生した(実際にプレイしたユーザーからの指摘)。文章を短くするだけでは、そもそも
 * 1行あたりの持ち時間(rise間隔)そのものが初心者向けに十分でなければ焼け石に水。
 *
 * そのため、行上昇の速さも難易度ごとに再度変える。ただし今度は「無限に生存できる」
 * 問題を防ぐため、easyでも以下の2点は守る:
 *   - 開始間隔(startIntervalMs)と加速の緩さ(accelPerSecondMs)は大きく緩めて、
 *     初心者が操作に慣れるまでの序盤に十分な余裕を作る(ここが今回の本題)。
 *   - 最終的な最短間隔(minIntervalMs)はnormalとの差を小さく保つ(以前のeasyは
 *     4000msでnormalの2400msと大差があり、それが無限生存の温床だった。今回は
 *     normalとの差を数百ms程度に抑え、長時間プレイすれば結局はnormal相当の
 *     圧力に収束するようにする)。
 * これにより「初心者は序盤を乗り切りやすい」かつ「上級者がeasyで無限に
 * スコアを稼げる」の両立を狙う。tierRatio(文章の長さ)による調整はD-033のまま
 * 維持し、rise速度の調整と組み合わせる。
 *
 * scoreMultiplier は世界ランキングに送信する際にスコアへ掛ける係数。
 * 実プレイのデータが無い状態での初期値なので、後で実際のスコア分布を見て
 * 調整する前提の暫定値(apps/web/api/scores.ts 側の定数と値を揃えること)。
 */
export interface SurvivalDifficultyProfile {
  rise: RiseConfig;
  tierRatio: Record<PhraseTier, number>;
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
  /** サバイバルの行上昇の速さ・文章の長さは難易度ごとに survivalDifficulty[*] を使う(D-038) */
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
      // 序盤の猶予をnormalの倍近くに。加速も緩やかにし、初心者が操作に
      // 慣れるまでの時間を大きく確保する。ただし最短間隔はnormalの2400msに
      // 対して2800msと差を小さく保ち、長時間プレイすればnormal相当の
      // 圧力に収束するようにして無限生存を防ぐ(D-038)。
      rise: {
        startIntervalMs: 9_500,
        minIntervalMs: 2_800,
        accelPerSecondMs: 10,
        warningMs: 2_000,
      },
      tierRatio: { short: 0.6, standard: 0.37, long: 0.03 },
      scoreMultiplier: 0.6,
    },
    normal: {
      rise: {
        startIntervalMs: 5_500,
        minIntervalMs: 2_400,
        accelPerSecondMs: 25,
        warningMs: 1_500,
      },
      tierRatio: { short: 0.2, standard: 0.65, long: 0.15 },
      scoreMultiplier: 1.0,
    },
    hard: {
      rise: {
        startIntervalMs: 4_200,
        minIntervalMs: 1_700,
        accelPerSecondMs: 32,
        warningMs: 1_200,
      },
      tierRatio: { short: 0.05, standard: 0.45, long: 0.5 },
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
