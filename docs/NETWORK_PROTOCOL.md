# NETWORK PROTOCOL(Phase 5 設計・未実装)

仕様書 §23 に基づく 1対1 DUEL のプロトコル設計。現時点でサーバーは存在しない。
実装時はこの文書を更新し、スキーマ検証(zod 等)を必須とする。

## 方針

- サーバーが権威。クライアントは同じ `game-core` で予測し、サーバー確定で補正
- クライアントはキー入力イベントだけを送る。「消去した」という結果は送らない(不正対策 §24)
- 全乱数は Match Seed から導出。サーバーとクライアントで同一盤面を再現

## Client → Server

```ts
interface KeyInputEvent {
  matchId: string;
  playerId: string;
  sequence: number;    // 単調増加。欠番・重複はサーバーで拒否
  key: string;         // 1文字 [a-z'-]
  clientTimeMs: number;
}
```

その他: `JOIN_ROOM { roomCode, displayName }`, `REMATCH_REQUEST`, `PING`

## Server → Client

| イベント | 内容 |
|----------|------|
| MATCH_STARTED | seed, config, 両プレイヤー情報 |
| INPUT_ACCEPTED | sequence, playerId |
| INPUT_REJECTED | sequence, 理由 |
| TARGET_LOCKED | playerId, blockId |
| BLOCK_CLEARED | playerId, blockIds, chain |
| CHAIN_RESOLVED | playerId, depth, attackPower |
| GARBAGE_QUEUED | 対象playerId, 個数, 着弾予定時刻 |
| GARBAGE_CANCELLED | 相殺結果 |
| GARBAGE_DROPPED | 着弾列(Seedから決定) |
| ROW_RAISED | playerId |
| MATCH_ENDED | 勝敗, 判定理由, 両者サマリー |
| PLAYER_DISCONNECTED / RECONNECTED | 8秒猶予(§23) |

## 勝敗判定(§5.2)

1. 相手の盤面が危険ラインを超えて2秒維持 → 即勝利
2. 時間終了時: 盤面最高到達段が低い → 送信妨害数が多い → スコアが高い

## 相殺

```text
自分の攻撃 12、受信待ち 7 → 受信待ち 0、相手へ 5
```

Incoming Meter に追加 → 1.5秒予告 → 予告中の攻撃で相殺 → 残りが着弾。

## 検証(サーバー側)

- sequence の単調増加、再送拒否
- 不可能な KPM、完全一定間隔の検出 → 疑わしい試合はランキング対象外
- 非表示タブからの入力無効
- クライアントからの直接消去要求は存在しない(受け付けるAPI自体を作らない)
