import { useEffect, useMemo, useState } from "react";
import type { TypingAnalysis } from "@type-burst/game-core";
import { resolveBoardTheme } from "@type-burst/progression";
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

type ResultScreenState = {
  name: "result";
  result: GameResult;
  history: StoredResult[];
  duelRecord: DuelRecord | null;
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
  const [screen, setScreen] = useState<Screen>({ name: "landing" });

  sound.enabled = settings.soundOn;

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(settings.fontScale));
    document.documentElement.classList.toggle("high-contrast", settings.highContrast);
  }, [settings.fontScale, settings.highContrast]);

  const updateSettings = (patch: Partial<Settings>): void => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  };

  const startGame = (mode: GameMode): void => {
    sound.unlock();
    setScreen({ name: "game", mode });
  };

  const finishGame = (result: GameResult): void => {
    if (result.mode === "survival") {
      const history = appendResult(result.summary);
      setScreen({ name: "result", result, history, duelRecord: null });
    } else {
      const duelRecord = recordDuel(result.summary);
      setScreen({ name: "result", result, history: loadResults(), duelRecord });
    }
    // appendResult/recordDuel は生涯累計(称号・アンロックの元データ)も更新済みなので読み直す
    setProgress(loadProgress());
  };

  // 盤面カラーテーマ(D-055): 未解放・High Contrast時はdefaultへフォールバックする
  const resolvedBoardTheme = resolveBoardTheme(
    settings.boardTheme,
    progress.totalScore,
    settings.highContrast,
  );

  switch (screen.name) {
    case "landing":
      return (
        <LandingScreen
          settings={settings}
          results={loadResults()}
          progress={progress}
          onUpdateSettings={updateSettings}
          onStart={startGame}
          onShowRanking={() => setScreen({ name: "ranking" })}
          onShowGrowth={() =>
            setScreen({ name: "analysis", analysis: null, recentHistory: loadResults(), back: { name: "landing" } })
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
          attributeColors={resolvedBoardTheme.colors}
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
          onRetry={(mode) => startGame(mode)}
          onBackToTitle={() => setScreen({ name: "landing" })}
          onShowAnalysis={(analysis, recentHistory) =>
            setScreen({ name: "analysis", analysis, recentHistory, back: resultScreen })
          }
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
