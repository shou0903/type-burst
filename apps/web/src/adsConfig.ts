/**
 * Google AdSense の設定。実際の値は AdSense 審査通過後にここだけ書き換える。
 * - client: AdSenseの「パブリッシャーID」(ca-pub-で始まる)
 * - slotLeft / slotRight: 画面左右に出す広告ユニットのスロットID
 *
 * 未設定(プレースホルダーのまま)の間は広告を一切読み込まない安全側の実装。
 */
export const ADSENSE_CLIENT_ID: string = "ca-pub-5471900652537950";
export const AD_SLOT_LEFT: string = "4097693499";
export const AD_SLOT_RIGHT: string = "6991450148";

/** 広告ユニット(スロット)も含めて全て設定済みか。実際の広告表示の可否に使う */
export function isAdsenseConfigured(): boolean {
  return (
    hasAdsenseClientId() &&
    AD_SLOT_LEFT !== "0000000000" &&
    AD_SLOT_RIGHT !== "0000000000"
  );
}

/**
 * パブリッシャーIDだけ設定済みか。サイト所有権確認用メタタグはこれだけで出してよい
 * (広告ユニット作成前でもGoogleの審査は進むため、スロットIDの有無を待たない)。
 */
export function hasAdsenseClientId(): boolean {
  return ADSENSE_CLIENT_ID !== "ca-pub-0000000000000000";
}
