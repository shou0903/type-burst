import { useState } from "react";
import { App } from "./App";
import { AdSlots } from "./components/AdSlots";
import { ConsentBanner, loadConsent, type ConsentState } from "./components/ConsentBanner";
import { SmallScreenGuard } from "./components/SmallScreenGuard";

/** 同意状態を ConsentBanner と AdSlots で共有するための最上位コンポーネント */
export function AppRoot(): JSX.Element {
  const [consent, setConsent] = useState<ConsentState>(() => loadConsent());

  return (
    <SmallScreenGuard>
      <>
        <AdSlots consent={consent} />
        <App />
        <ConsentBanner onChange={setConsent} />
      </>
    </SmallScreenGuard>
  );
}
