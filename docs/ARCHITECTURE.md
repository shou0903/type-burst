# ARCHITECTURE

## パッケージ構成と依存方向

```text
apps/web ──────────────┐
                       ▼
        packages/game-core ──▶ packages/typing-engine
                       │                ▲
                       └──▶ packages/phrase-content
```

- 依存は常に上から下へ。`typing-engine` は何にも依存しない
- 各パッケージは TypeScript ソースを直接公開し、Vite / Vitest がエイリアス解決する(ビルドステップなし)

## typing-engine

読み仮名1件 → ローマ字入力の NFA(非決定性オートマトン)。

- `segmentKana()`: かな列をセグメント列に分割。促音は次のセグメントと結合(`っこ` → `kko` / `xtuko` …)、「ん」は次のセグメントを見て単独 `n` の可否を決める、拗音は直接表記と分解表記(`sha` / `sixya`)の両方を受理
- `TypingAutomaton`: 状態 = (セグメント番号, セグメント内プレフィックス) の集合。`feed(key)` で全状態を同時遷移し、1つでも進めば正解キー。ε遷移(セグメント完了 → 次セグメント)はクロージャで処理
- ガイド表示用に最短経路の残りローマ字を返す

## game-core

DOM・描画・音・ネットワークへ依存しない純ロジック。

- `BlitzGame`: 権威状態。`advance(deltaMs)` と `feedKey(key)` だけで駆動され、`GameEvent[]` を返す。同じ Seed + 同じ呼び出し列 → 同じ結果(決定論、テストで検証済み)
- `Prng`: xmur3 ハッシュ + mulberry32。`Math.random()` はゲーム結果に不使用
- 盤面操作(`findGroup` / `findAutoGroups` / `applyGravity`)は純関数
- 連鎖解決はステージマシン: `hitstop(70ms) → clearing(150ms) → falling(120ms) → 再判定`。途中の全イベント(`blocksCleared`, `chainFinished` 等)を発行する

### イベント駆動

UI は Snapshot(毎フレームの盤面ビュー)と GameEvent(発生した出来事)だけを見る。
イベントは「音を鳴らす・パーティクルを出す」ためのもので、ゲーム状態はすべて Snapshot にある。

## apps/web

- `GameController`: rAF ループで `advance` を呼び、イベントを `BoardRenderer`(Canvas 2D)と `SoundEngine`(Web Audio シンセ)へ配る。キーボードイベントの取得と IME 検出もここ
- `BoardRenderer`: Snapshot を描画。落下・せり上がりは表示位置の指数平滑で補間し、ロジックの座標には一切影響しない。パーティクル・CHAIN ポップアップ・画面シェイク・危険ライン
- React はメニュー・HUD・結果画面のみ。盤面計算を React コンポーネントに書かない(仕様書 §21)
- `hooks/useFitToViewport.ts`: コンテンツがビューポートより高い場合に `transform: scale()` で自動縮小する(D-020)。ブックマークバー等でビューポートが縮んでも画面上部が到達不能にならないための対策
- `storage.ts`: localStorage に設定と直近10試合を保存(§27)

## 決定論と将来のオンライン対戦

`BlitzGame` は wall-clock を持たず、外から与えられた deltaMs だけで進む。
Phase 5 では同じ game-core をサーバー(権威)とクライアント(予測)の両方で動かし、
`KeyInputEvent`(sequence 番号付き)をサーバーが検証する設計(NETWORK_PROTOCOL.md)。
