import { useEffect, useState } from "react";
import { AD_SLOT_LEFT, AD_SLOT_RIGHT, ADSENSE_CLIENT_ID, isAdsenseConfigured } from "../adsConfig";

/** 1120pxのホーム本文と左右160px広告の間に、それぞれ20px以上の余白を確保できる幅 */
const MIN_WIDTH_FOR_ADS = 1520;

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
    <aside className={`ad-slot ad-slot-${side}`} aria-label={`${side === "left" ? "左" : "右"}側の広告`}>
      {/* ナビゲーションと誤認されないよう、広告であることを明示するラベル(D-081) */}
      <span className="ad-slot-label" aria-hidden="true">
        広告
      </span>
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: 160 }}
        data-ad-client={ADSENSE_CLIENT_ID}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}

/**
 * 画面両サイドの手動広告枠。Google CMP が地域別の同意を管理するため、
 * ここではAdSense設定済み・ビューポートが十分広い場合だけ枠を描画する。
 */
export function AdSlots(): JSX.Element | null {
  const [wideEnough, setWideEnough] = useState(() => window.innerWidth >= MIN_WIDTH_FOR_ADS);

  useEffect(() => {
    const onResize = (): void => setWideEnough(window.innerWidth >= MIN_WIDTH_FOR_ADS);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!isAdsenseConfigured() || !wideEnough) return null;

  return (
    <>
      <AdSlot side="left" slotId={AD_SLOT_LEFT} />
      <AdSlot side="right" slotId={AD_SLOT_RIGHT} />
    </>
  );
}
