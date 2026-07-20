import { useEffect, useState } from "react";
import { AD_SLOT_LEFT, AD_SLOT_RIGHT, ADSENSE_CLIENT_ID, isAdsenseConfigured } from "../adsConfig";
import type { ConsentState } from "./ConsentBanner";

/** ゲーム盤面(最大幅約1050px)と両側の広告が重ならない最小ビューポート幅 */
const MIN_WIDTH_FOR_ADS = 1450;

let scriptLoadStarted = false;

function loadAdsenseScript(): void {
  if (scriptLoadStarted) return;
  scriptLoadStarted = true;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`;
  script.crossOrigin = "anonymous";
  document.head.appendChild(script);
}

function AdSlot({ side, slotId }: { side: "left" | "right"; slotId: string }): JSX.Element {
  useEffect(() => {
    try {
      (window as unknown as { adsbygoogle?: unknown[] }).adsbygoogle ??= [];
      (window as unknown as { adsbygoogle: unknown[] }).adsbygoogle.push({});
    } catch {
      // AdSenseスクリプト未読み込み等は無視(広告が出ないだけでゲームには影響しない)
    }
  }, []);

  return (
    <div className={`ad-slot ad-slot-${side}`}>
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: 160, height: 600 }}
        data-ad-client={ADSENSE_CLIENT_ID}
        data-ad-slot={slotId}
        data-full-width-responsive="false"
      />
    </div>
  );
}

/**
 * 画面両サイドの広告枠。同意("ConsentBanner")取得済み・AdSense設定済み・
 * ビューポートが十分広い場合のみ表示する(D-026)。
 */
export function AdSlots({ consent }: { consent: ConsentState }): JSX.Element | null {
  const [wideEnough, setWideEnough] = useState(() => window.innerWidth >= MIN_WIDTH_FOR_ADS);

  useEffect(() => {
    const onResize = (): void => setWideEnough(window.innerWidth >= MIN_WIDTH_FOR_ADS);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (consent === "accepted" && isAdsenseConfigured()) {
      loadAdsenseScript();
    }
  }, [consent]);

  if (consent !== "accepted" || !isAdsenseConfigured() || !wideEnough) return null;

  return (
    <>
      <AdSlot side="left" slotId={AD_SLOT_LEFT} />
      <AdSlot side="right" slotId={AD_SLOT_RIGHT} />
    </>
  );
}
