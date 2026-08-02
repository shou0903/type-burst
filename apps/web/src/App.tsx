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
  loadProgress,
  loadResults,
  loadSettings,
  recordDuel,
  saveSettings,
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
import { trackAttributedGameStart, trackFunnelEvent } from "./seoAttribution";

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
  const [screen, setScreen] = useState<Screen>({ name: "landing" });

  sound.enabled = settings.soundOn;

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

  const startGame = (mode: GameMode): void => {
    sound.unlock();
    trackAttributedGameStart(mode.type);
    trackFunnelEvent("Mode Started", { mode: mode.type });
    const resolvedMode =
      mode.type === "daily"
        ? {
            ...mode,
            ranked: isDailyRankedAttempt(loadDailyProgress(), mode.challengeId),
          }
        : mode;
    setScreen({ name: "game", mode: resolvedMode });
  };

  const finishGame = (result: GameResult): void => {
    trackFunnelEvent("Game Finished", { mode: result.mode });
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
          results={loadResults()}
          progress={progress}
          dailyProgress={dailyProgress}
          onUpdateSettings={updateSettings}
          onStart={startGame}
          onShowRanking={() => {
            trackFunnelEvent("Navigation", { destination: "ranking" });
            setScreen({ name: "ranking" });
          }}
          onShowGrowth={() =>
            setScreen({
              name: "analysis",
              analysis: null,
              recentHistory: loadResults().filter((entry) => entry.mode !== "daily"),
              back: { name: "landing" },
            })
          }
        />
      );
    case "game":
      return (
        <GameScreen
          mode={screen.mode}
          sound={sound}
          reducedMotion={settings.reducedMotion}
          highContrast={settings.highContrast}
          fontScale={settings.fontScale}
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
        />
      );
    case "ranking":
      return <RankingScreen onBack={() => setScreen({ name: "landing" })} />;
  }
}
