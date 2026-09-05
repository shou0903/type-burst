import { useEffect } from "react";
import { Analytics } from "@vercel/analytics/react";
import { App } from "./App";
import { SmallScreenGuard } from "./components/SmallScreenGuard";
import { captureContentAttribution } from "./seoAttribution";
import { isBehaviorTelemetryEnabled } from "./behaviorTelemetry";

export function AppRoot(): JSX.Element {
  useEffect(() => {
    // 旧独自バナーの選択値はGoogle CMPへ移行後に使用しないため削除する。
    try {
      localStorage.removeItem("typeblast.adConsent.v1");
    } catch {
      // localStorageを利用できない環境でもゲームは継続する
    }
    captureContentAttribution();
  }, []);

  return (
    <SmallScreenGuard>
      <>
        <App />
        <Analytics beforeSend={(event) => (isBehaviorTelemetryEnabled() ? event : null)} />
      </>
    </SmallScreenGuard>
  );
}
