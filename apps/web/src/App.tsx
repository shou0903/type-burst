import { useEffect, useMemo, useState } from "react";
import { SoundEngine } from "./audio/SoundEngine";
import type { GameMode, GameResult } from "./game/GameController";
import { LandingScreen } from "./screens/LandingScreen";
import { GameScreen } from "./screens/GameScreen";
import { ResultScreen } from "./screens/ResultScreen";
import {
  appendResult,
  loadResults,
  loadSettings,
  recordDuel,
  saveSettings,
  type DuelRecord,
  type Settings,
  type StoredResult,
} from "./storage";

type Screen =
  | { name: "landing" }
  | { name: "game"; mode: GameMode }
  | {
      name: "result";
      result: GameResult;
      history: StoredResult[];
      duelRecord: DuelRecord | null;
    };

export function App(): JSX.Element {
  const sound = useMemo(() => new SoundEngine(), []);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
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
  };

  switch (screen.name) {
    case "landing":
      return (
        <LandingScreen
          settings={settings}
          results={loadResults()}
          onUpdateSettings={updateSettings}
          onStart={startGame}
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
    case "result":
      return (
        <ResultScreen
          result={screen.result}
          history={screen.history}
          duelRecord={screen.duelRecord}
          onRetry={(mode) => startGame(mode)}
          onBackToTitle={() => setScreen({ name: "landing" })}
        />
      );
  }
}
