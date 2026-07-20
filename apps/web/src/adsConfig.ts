/**
 * Google AdSense の設定。実際の値は AdSense 審査通過後にここだけ書き換える。
 * - client: AdSenseの「パブリッシャーID」(ca-pub-で始まる)
 * - slotLeft / slotRight: 画面左右に出す広告ユニットのスロットID
 *
 * 未設定(プレースホルダーのまま)の間は広告を一切読み込まない安全側の実装。
 */
export const ADSENSE_CLIENT_ID = "ca-pub-0000000000000000";
export const AD_SLOT_LEFT = "0000000000";
export const AD_SLOT_RIGHT = "0000000000";

export function isAdsenseConfigured(): boolean {
  return (
    ADSENSE_CLIENT_ID !== "ca-pub-0000000000000000" &&
    AD_SLOT_LEFT !== "0000000000" &&
    AD_SLOT_RIGHT !== "0000000000"
  );
}
