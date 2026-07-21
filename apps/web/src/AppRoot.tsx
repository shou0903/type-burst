import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { App } from "./App";
import { ADSENSE_CLIENT_ID, hasAdsenseClientId } from "./adsConfig";
import { AdSlots } from "./components/AdSlots";
import { ConsentBanner, loadConsent, type ConsentState } from "./components/ConsentBanner";
import { SmallScreenGuard } from "./components/SmallScreenGuard";

/** 同意状態を ConsentBanner と AdSlots で共有するための最上位コンポーネント */
export function AppRoot(): JSX.Element {
  const [consent, setConsent] = useState<ConsentState>(() => loadConsent());

  useEffect(() => {
    // AdSenseのサイト所有権確認用メタタグ。Cookieを一切使わない静的な宣言なので
    // 同意バナーとは無関係に、設定済みなら常に出しておく(審査に必要なため)。
    if (!hasAdsenseClientId()) return;
    if (document.querySelector('meta[name="google-adsense-account"]')) return;
    const meta = document.createElement("meta");
    meta.name = "google-adsense-account";
    meta.content = ADSENSE_CLIENT_ID;
    document.head.appendChild(meta);
  }, []);

  return (
    <SmallScreenGuard>
      <>
        <AdSlots consent={consent} />
        <App />
        <ConsentBanner onChange={setConsent} />
        {/* Cookie不使用・個人を特定しない集計のみのため同意バナーとは無関係に常時計測(D-037) */}
        <Analytics />
      </>
    </SmallScreenGuard>
  );
}
