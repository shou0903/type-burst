/**
 * 共有結果ページからゲームへ戻す遷移先の許可リスト。
 * APIへ任意URLを保存させず、同一サイト内の既知の導線だけを受け付ける。
 */
export const HOME_SHARE_TARGET = "/";
export const DAILY_SHARE_TARGET = "/?mode=daily&source=share#play";

export type ShareTarget = typeof HOME_SHARE_TARGET | typeof DAILY_SHARE_TARGET;

export function normalizeShareTarget(value: unknown): ShareTarget {
  return value === DAILY_SHARE_TARGET ? DAILY_SHARE_TARGET : HOME_SHARE_TARGET;
}

export function isDailyShareTarget(value: ShareTarget): boolean {
  return value === DAILY_SHARE_TARGET;
}
