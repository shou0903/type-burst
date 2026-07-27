const PLAYER_ID_KEY = "typeblast.player-id.v1";
const LEGACY_DAILY_PLAYER_ID_KEY = "typeblast.daily-player.v1";

let memoryPlayerId: string | null = null;

function createPlayerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 登録不要の匿名プレイヤーID。旧デイリーIDを優先して移行するため、
 * 既存のデイリーランキング上の本人識別子は変わらない。
 */
export function loadPlayerId(): string {
  if (memoryPlayerId) return memoryPlayerId;
  try {
    const current = localStorage.getItem(PLAYER_ID_KEY);
    if (current) return (memoryPlayerId = current);

    const legacy = localStorage.getItem(LEGACY_DAILY_PLAYER_ID_KEY);
    const playerId = legacy || createPlayerId();
    localStorage.setItem(PLAYER_ID_KEY, playerId);
    // 旧キーは残す。古いデイリー処理や別タブでも同じIDを読み続けられる。
    if (!legacy) localStorage.setItem(LEGACY_DAILY_PLAYER_ID_KEY, playerId);
    return (memoryPlayerId = playerId);
  } catch {
    // private mode 等でもゲームは止めない。ページを開いている間だけ同じIDを使う。
    return (memoryPlayerId ??= createPlayerId());
  }
}
