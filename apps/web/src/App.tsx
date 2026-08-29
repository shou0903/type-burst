import { useEffect, useMemo, useState } from "react";
import type { TypingAnalysis } from "@type-burst/game-core";
import { SoundEngine } from "./audio/SoundEngine";
import type { GameMode, GameResult } from "./game/GameController";
import { LandingScreen } from "./screens/LandingScreen";
import { GameScreen } from "./screens/GameScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { RankingScreen } from "./screens/RankingScreen";
import { AnalysisScreen } from "./screens/AnalysisScreen";
import {
  appendResult,
  bestScore,
  getStoredResultRuleset,
  loadDuelRecord,
  loadProgress,
  loadResults,
  loadSettings,
  loadTutorialCompleted,
  markTutorialCompleted,
  recordDuel,
  saveSettings,
  SURVIVAL_RULESET,
  type DuelRecord,
  type Settings,
  type StoredResult,
} from "./storage";
import type { LifetimeProgress } from "@type-burst/progression";
import {
  isDailyRankedAttempt,
  loadDailyProgress,
  recordDailyResult,
  type DailyProgress,
  type DailyRecordResult,
} from "./daily";
import { queueSnapshotUpload } from "./playerData";
import {
  trackAttributedGameStart,
  trackFunnelEvent,
  trackLandingView,
  trackTutorialCompleted,
} from "./seoAttribution";
import { hasRecordedPlay } from "./onboarding";
import { DEFAULT_FOCUS_GOAL, type FocusGoalId } from "./focusContract";

type ResultScreenState = {
  name: "result";
  result: GameResult;
  history: StoredResult[];
  duelRecord: DuelRecord | null;
  dailyRecord: DailyRecordResult | null;
};

type AnalysisBack = { name: "landing" } | ResultScreenState;

type Screen =
  | { name: "landing" }
  | { name: "game"; mode: GameMode }
  | ResultScreenState
  | {
      name: "analysis";
      /** null = 結果画面を経由せず(例: タイトル画面から)開いた場合。長期成長グラフのみ表示する */
      analysis: TypingAnalysis | null;
      recentHistory: StoredResult[];
      back: AnalysisBack;
    }
  | { name: "ranking" };

export function App(): JSX.Element {
  const sound = useMemo(() => new SoundEngine(), []);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [progress, setProgress] = useState<LifetimeProgress>(() => loadProgress());
  const [dailyProgress, setDailyProgress] = useState<DailyProgress>(() => loadDailyProgress());
  const [tutorialCompleted, setTutorialCompleted] = useState<boolean>(() => loadTutorialCompleted());
  // FOCUS は通常サバイバルの1プレイにだけ添付する。mode本体の既存契約を
  // 変えず、余分な値として保持するため daily/duel/tutorial へ漏れない。
  const [selectedFocusGoal, setSelectedFocusGoal] = useState<FocusGoalId>(DEFAULT_FOCUS_GOAL);
  const [screen, setScreen] = useState<Screen>({ name: "landing" });
  // tutorial完了直後に同じGameScreenを再利用しないためのマウント世代。
  const [gameSession, setGameSession] = useState(0);

  sound.enabled = settings.soundOn;
  const currentResults = loadResults();
  const hasPlayed = hasRecordedPlay(
    progress,
    currentResults,
    dailyProgress,
    loadDuelRecord(),
  );
  const firstRun = !hasPlayed && !tutorialCompleted;

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(settings.fontScale));
    document.documentElement.classList.toggle("high-contrast", settings.highContrast);
    // CSSアニメーション(ホーム画面の登場演出・環境演出)もアプリ内の
    // 「演出を控えめにする」設定に従わせるためのフック(D-085)。
    // OS側の prefers-reduced-motion とは独立に、ユーザーが明示的に切れるようにする。
    document.documentElement.classList.toggle("reduced-motion", settings.reducedMotion);
  }, [settings.fontScale, settings.highContrast, settings.reducedMotion]);

  const updateSettings = (patch: Partial<Settings>): void => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  };

  useEffect(() => {
    if (screen.name !== "landing") return;
    trackLandingView();
  }, [progress.totalGames, screen.name, tutorialCompleted]);

  const startGame = (mode: GameMode, focusGoal?: FocusGoalId): void => {
    sound.unlock();
    const firstPlay = !hasPlayed;
    trackAttributedGameStart(mode.type, firstPlay);
    const resolvedMode =
      mode.type === "daily"
        ? {
            ...mode,
            ranked: isDailyRankedAttempt(loadDailyProgress(), mode.challengeId),
          }
        : mode;
    const modeWithFocus =
      resolvedMode.type === "survival"
        ? {
            ...resolvedMode,
            // GameModeを後方互換のまま保つため optional carrier として渡す。
            // GameScreen/GameController側ではこの値を通常サバイバルのFOCUSへ接続する。
            focusGoal: focusGoal ?? selectedFocusGoal,
          }
        : resolvedMode;
    if (modeWithFocus.type === "survival") {
      setSelectedFocusGoal(modeWithFocus.focusGoal);
    }
    setGameSession((current) => current + 1);
    setScreen({ name: "game", mode: modeWithFocus });
  };

  const completeTutorial = (): void => {
    const firstPlay = firstRun;
    markTutorialCompleted();
    setTutorialCompleted(true);
    trackTutorialCompleted(firstPlay);
    if (firstPlay) {
      // 初回完了直後だけは迷わせず初級へ渡す。復習した既存ユーザーは
      // 期待どおりタイトルへ戻し、勝手に別モードを開始しない。
      startGame({ type: "survival", difficulty: "easy" });
    } else {
      setScreen({ name: "landing" });
    }
  };

  const finishGame = (result: GameResult): void => {
    const firstPlay = progress.totalGames === 0;
    trackFunnelEvent("Game Finished", { mode: result.mode, firstPlay });
    if (result.mode === "survival") {
      const history = appendResult(result.summary);
      setScreen({ name: "result", result, history, duelRecord: null, dailyRecord: null });
    } else if (result.mode === "daily") {
      const dailyRecord = recordDailyResult(
        result.challengeId,
        result.summary,
        result.ranked,
      );
      const history = appendResult(result.summary, "daily");
      setDailyProgress(dailyRecord.progress);
      setScreen({ name: "result", result, history, duelRecord: null, dailyRecord });
    } else {
      const duelRecord = recordDuel(result.summary);
      setScreen({
        name: "result",
        result,
        history: loadResults(),
        duelRecord,
        dailyRecord: null,
      });
    }
    // appendResult/recordDuel は生涯累計(称号・アンロックの元データ)も更新済みなので読み直す
    setProgress(loadProgress());
    // UIを待たせず、失敗時も静かに無視する匿名スナップショット保存。
    queueSnapshotUpload();
  };

  switch (screen.name) {
    case "landing":
      return (
        <LandingScreen
          settings={settings}
          results={currentResults}
          progress={progress}
          dailyProgress={dailyProgress}
          firstRun={firstRun}
          onUpdateSettings={updateSettings}
          onStart={startGame}
          onStartWithFocus={(mode, focusGoal) => startGame(mode, focusGoal)}
          onShowRanking={() => {
            setScreen({ name: "ranking" });
          }}
          onShowGrowth={() =>
            setScreen({
              name: "analysis",
              analysis: null,
              // ルール更新直後の伸びを旧サバイバルと比較すると、上達ではなく
              // ルール差をグラフ化してしまう。成長記録も現行v2だけに揃える。
              recentHistory: loadResults().filter(
                (entry) => getStoredResultRuleset(entry) === SURVIVAL_RULESET,
              ),
              back: { name: "landing" },
            })
          }
        />
      );
    case "game":
      return (
        <GameScreen
          key={gameSession}
          mode={screen.mode}
          sound={sound}
          reducedMotion={settings.reducedMotion}
          highContrast={settings.highContrast}
          fontScale={settings.fontScale}
          survivalBestScore={
            screen.mode.type === "survival"
              ? bestScore(currentResults, screen.mode.difficulty)
              : 0
          }
          tutorialCompletionStartsGame={firstRun}
          onTutorialComplete={completeTutorial}
          onFinish={finishGame}
          onQuit={() => setScreen({ name: "landing" })}
        />
      );
    case "result": {
      const resultScreen = screen;
      return (
        <ResultScreen
          result={screen.result}
          history={screen.history}
          duelRecord={screen.duelRecord}
          progress={progress}
          dailyProgress={dailyProgress}
          dailyRecord={screen.dailyRecord}
          reducedMotion={settings.reducedMotion}
          onRetry={(mode) => {
            trackFunnelEvent("Result Action", { action: "retry", mode: mode.type });
            startGame(mode);
          }}
          onBackToTitle={() => setScreen({ name: "landing" })}
          onShowAnalysis={(analysis, recentHistory) => {
            trackFunnelEvent("Result Action", { action: "analysis", mode: resultScreen.result.mode });
            setScreen({ name: "analysis", analysis, recentHistory, back: resultScreen });
          }}
        />
      );
    }
    case "analysis":
      return (
        <AnalysisScreen
          analysis={screen.analysis}
          recentHistory={screen.recentHistory}
          progress={progress}
          onBack={() => setScreen(screen.back)}
          onStart={() => startGame({ type: "survival", difficulty: "easy" })}
        />
      );
    case "ranking":
      return <RankingScreen onBack={() => setScreen({ name: "landing" })} />;
  }
}
