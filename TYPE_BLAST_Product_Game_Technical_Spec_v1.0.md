# TYPE BLAST
## プロダクト要件・ゲームデザイン・技術設計書
**Version:** 1.0  
**Status:** Implementation-ready  
**Working title:** TYPE BLAST  
**対象:** コーディングAI、Webゲームエンジニア、UI/UXデザイナー

---

# 0. この文書の扱い

本書を実装の正本とする。コーディングAIは以下を守ること。

1. ゲームを格闘ゲーム、RPG、長文練習ソフトへ変更しない。
2. 標準問題は自然な日本語の語句・短文・文章とする。
3. `configuration`、`result_data.csv`、コード断片、URL、英字だけの文字列を標準問題に入れない。
4. まず30秒ソロ版を完成させ、その後1対1対戦を実装する。
5. 外部生成AI APIを使わない。
6. ゲーム結果はSeedと入力イベントから再現可能にする。
7. 仕様変更は `DECISIONS.md` に記録する。
8. キャラクター、ストーリー、スキル、装備、ガチャはMVPへ追加しない。
9. 追加機能より、文章完成時の爆発、落下、連鎖、妨害着弾の気持ちよさを優先する。

---

# 1. プロダクト概要

## 1.1 一文説明

日本語が書かれたブロックをローマ字入力で爆破し、同色ブロックの落下連鎖を起こして相手へ妨害を送る、30〜60秒のブラウザ対戦ゲーム。

## 1.2 コンセプト

> 普通に面白い連鎖パズルを遊んでいたら、結果として日本語タイピングが速くなる。

タイピング練習をゲーム風に見せるのではなく、連鎖パズルの操作手段として日本語タイピングを使う。

## 1.3 中心体験

1. 盤面から消したい日本語ブロックを見つける
2. ローマ字で文章を入力する
3. 入力完了と同時にブロックが爆発する
4. 同色グループが消える
5. 上のブロックが落下する
6. 新しい同色グループができると自動連鎖する
7. 連鎖攻撃が相手の盤面へ妨害として降る
8. 30〜60秒で決着し、すぐ再戦できる

## 1.4 目指さないもの

- タイピング格闘ゲーム
- 10分以上の学習を前提とする教材
- 英文やコード入力を中心とするゲーム
- HPを削るだけの対戦
- スマートフォンのフリック入力ゲーム
- 公開チャットSNS

---

# 2. 成功条件

## 2.1 KPI

- 初回訪問から30秒ソロ開始率
- 初回終了後の「もう一戦」率
- 1セッション平均試合数
- 友達対戦URL共有率
- 対戦後再戦率
- 7日以内再訪率
- 継続利用によるKPMと正確率の改善
- 60fps維持率
- 対戦切断率

## 2.2 初期目標

- ページ表示からプレイ開始まで20秒以内
- 初回プレイ完了率80%以上
- ソロ即時再戦率45%以上
- 友達対戦再戦率55%以上
- 平均3試合/セッション以上
- 入力から反応まで50ms未満を目標
- 通常時60fps
- 登録なしで主要機能を利用可能

---

# 3. ターゲット

## Primary

- 高校生、大学生、大学院生
- 新社会人
- タイピング速度に不安がある人
- 寿司打などを短時間遊ぶ人
- パズルゲームや短時間対戦が好きな人
- 研究室、学校、会社で友達と競いたい人

## 利用場面

- 授業や研究の休憩
- 昼休み
- オンライン通話中
- 仕事前のウォームアップ
- 研究室や会社の小規模大会

---

# 4. プラットフォーム

## MVP

- PCブラウザ
- 物理キーボード必須
- 横画面
- 推奨最小幅1024px
- ゲストプレイ
- インストール不要
- Chrome、Edge、Safari、Firefoxの現行安定版

## MVP外

- スマートフォン最適化
- ネイティブアプリ
- フリック入力
- IME漢字変換対戦
- ゲームパッド

---

# 5. ゲームモード

## 5.1 BLITZ

30秒の1人用スコアアタック。

目的:
- 最初の入口
- 爆発と連鎖をすぐ理解させる
- 対戦相手なしでも遊べる
- 推定KPMと正確率を取得する

結果:
- スコア
- 最大連鎖
- KPM
- 正確率
- 文章完成数
- もう一戦

## 5.2 DUEL

60秒の1対1。

勝利条件:
1. 相手の盤面が危険ラインを超えて2秒維持されたら即勝利
2. 時間終了時は次の順で判定
   - 盤面最高到達段が低い
   - 送信妨害数が多い
   - スコアが高い

## 5.3 PRIVATE ROOM

- 6文字ルームコード
- 招待URL
- ゲスト名だけで参加
- 30秒または60秒
- 再戦
- 自由チャットなし

## 5.4 GHOST

過去プレイヤーの入力・攻撃履歴を再生する疑似対戦。初期過疎対策として、リアルタイム対戦前に実装してよい。

---

# 6. 盤面

## 6.1 サイズ

```text
列: 6
表示行: 10
危険ライン: 上から2行目
初期配置: 下から6行
```

## 6.2 ブロック

各ブロックは以下を持つ。

- 日本語の語句・短文・文章
- 4属性のいずれか
- 色に対応した形状アイコン
- 入力進捗
- 状態
- 問題ID

## 6.3 属性

- 炎 / 三角
- 水 / 円
- 風 / ひし形
- 光 / 星

色だけで識別させない。

## 6.4 初期盤面生成条件

- 同属性4個以上の連結グループを作らない
- 同一文章を重複配置しない
- 属性を極端に偏らせない
- SHORT / STANDARD / LONGを規定比率で混ぜる
- 同じSeedなら同じ盤面
- 同時表示する文章のローマ字冒頭衝突を減らす

---

# 7. 日本語問題

## 7.1 原則

標準問題は自然な日本語にする。

良い例:

- 空が明るくなる
- 資料を確認する
- 会議を始めます
- 今日は早く帰ります
- 明日の予定を決める
- 忘れ物に気をつける
- 落ち着いて入力する
- 電車が駅に到着した
- 新しい方法を試してみる
- 最後まで正確に打ち切る

入れない例:

- configuration
- result_data.csv
- file_09
- URL
- メールアドレス
- コード
- 英字だけの文字列
- 意味のない記号列
- 不自然な日本語

## 7.2 Tier

### SHORT
- 5〜9モーラ程度
- 20%
- 例: 空が晴れる / 本を読みます

### STANDARD
- 10〜17モーラ程度
- 65%
- 例: 資料を確認する / 明日の予定を決める

### LONG
- 18〜26モーラ程度
- 15%
- 例: 今日は少し早めに帰ります / 新しい方法をみんなで試してみる

## 7.3 カテゴリ

- 日常
- 学校
- 仕事
- 移動
- 季節
- 食事
- 会話
- 行動
- 前向きな表現

## 7.4 禁止内容

- 歌詞、小説、漫画、映画の台詞
- 実在人物の発言
- 差別、侮辱、性的表現
- 政治・宗教的勧誘
- 自傷・暴力を促す表現
- 医療・投資助言
- 商品広告
- 読みが曖昧な漢字
- 固有名詞に依存する文章

## 7.5 句読点

MVP標準モードでは表示しても入力対象にはしない。入力はローマ字の連続列とする。

---

# 8. 問題データモデル

```ts
type PhraseTier = "short" | "standard" | "long";

interface JapanesePhrase {
  id: string;
  displayText: string;
  readingKana: string;
  tier: PhraseTier;
  category: string;
  moraCount: number;
  weight: number;
  enabled: boolean;
  source: "original";
  notes?: string;
}
```

ローマ字候補を手書きで列挙せず、`readingKana` から受理グラフを生成する。

---

# 9. ローマ字入力エンジン

## 9.1 必須対応

- し: shi / si
- ち: chi / ti
- つ: tsu / tu
- ふ: fu / hu
- じ: ji / zi
- しゃ: sha / sya
- ちゃ: cha / tya
- じゃ: ja / jya / zya
- ん: 文脈に応じて n / nn / n'
- っ: 子音重複 / xtu / ltu
- 小書き文字: x / l 系
- カタカナはひらがなへ正規化

## 9.2 API

```ts
interface TypingAutomaton {
  reset(): void;
  feed(key: string): FeedResult;
  isAccepted(): boolean;
  getProgress(): number;
  getExpectedKeys(): string[];
}
```

## 9.3 ミス

- 誤キーは進捗させない
- 正しい進捗は消さない
- バックスペースを必須にしない
- 長い操作不能を入れない
- 正確率とPerfect Streakへ反映
- 大きく不快なミス音を鳴らさない

## 9.4 ターゲット選択

1. 全ブロックの受理グラフを保持
2. 最初のキーで候補を発光
3. 入力で候補を絞る
4. 1個になればロック
5. 完了で破壊
6. 候補ゼロならミスとして選択バッファのみリセット

マウス選択は補助として将来追加可能だが、キーボードだけで完結させる。

## 9.5 IME

MVPは英数入力モードでローマ字を直接取得する。日本語IMEがONの場合は開始前に切替案内を表示する。

---

# 10. 正式な消去・連鎖ルール

## 10.1 直接消去

入力完了ブロックを `triggerBlock` とする。

1. 上下左右でつながる同属性グループを取得
2. グループが3個以上なら全体を消去
3. 1〜2個なら `triggerBlock` のみ消去
4. 消去後に重力落下
5. 落下完了後、自動連鎖判定

斜めは連結に含めない。

## 10.2 自動連鎖

落下完了後、上下左右で連結した同属性4個以上の全グループを探索する。

- 条件を満たす全グループを同時消去
- これを1段階のChainとする
- 再び落下
- 新しい4個以上ができれば次Chain
- 安定するまで繰り返す

## 10.3 Chain表示

- 直接3個以上消去: `1 CHAIN`
- 直接1個のみ: 表示なし
- その後の自動消去: 2、3…と増加
- 単独消去後に初めて自動消去が起きた場合、その自動消去を `1 CHAIN`

## 10.4 同時消去

同じ段階で複数グループが成立したら同時消去。消去数と最大グループ数を攻撃へ反映する。

## 10.5 連鎖演出

- 連鎖中は新しい入力を受け付けない
- 1段階120〜180ms
- 連鎖全体は原則1.2秒以内
- 連鎖中は行上昇を一時停止
- 長い演出でプレイ時間を奪わない

---

# 11. 新規行

## BLITZ
- 通常5.0秒ごと
- 残り10秒は3.5秒ごと

## DUEL
- 通常5.5秒ごと
- 残り20秒は4.0秒ごと

下から1行追加し、全体を押し上げる。1.5秒前に視覚・音で予告する。連鎖中は待機する。

新規行だけで即4連結を作らない。ただし既存盤面と接続して連鎖候補になることは許可する。

---

# 12. 妨害ブロック

## 12.1 性質

- 無属性
- 連鎖に含まれない
- 自然な日本語文章を表示
- 直接入力で破壊可能
- 隣接爆発でも破壊可能
- 鍵アイコンを表示

例:
- 落ち着いて入力する
- 最後まで正確に打つ
- 目の前の文章に集中する
- 慌てず一文字ずつ進める

## 12.2 着弾

1. 相手の攻撃をIncoming Meterへ追加
2. 1.5秒予告
3. 予告中の自分の攻撃で相殺
4. 残りだけ着弾
5. Seedに基づき列へ分散

## 12.3 相殺

```text
自分の攻撃: 12
受信待ち: 7
結果:
受信待ち 0
相手へ 5
```

---

# 13. 攻撃力

全値をConfig化する。

```ts
basePower =
  coloredBlocksCleared
  + garbageBlocksDestroyed * 0.5;
```

```ts
const CHAIN_BONUS = [0, 0, 2, 5, 9, 14, 20, 27, 35, 44];
```

```ts
simultaneousBonus = Math.max(0, largestGroupSize - 3);
perfectBonus = perfectPhraseStreak >= 5 ? 2 : 0;

attackPower =
  basePower +
  chainBonus +
  simultaneousBonus +
  perfectBonus;

garbageBlocksToSend = Math.floor(attackPower / 4);
```

1処理の送信上限は初期値18個。

---

# 14. スコア

```ts
score =
  correctKeyCount * 10
  + coloredBlocksCleared * 100
  + garbageBlocksDestroyed * 120
  + chainDepth * chainDepth * 500
  + perfectPhraseCount * 150;
```

スコアは対戦の第一勝敗条件ではない。

---

# 15. 爽快感

## 正しいキー
- 入力進捗を即時表示
- ブロックがわずかに反応
- 軽いキー音
- 長文は進捗に応じ発光

## 文章完成
- 40〜80msのヒットストップ
- 亀裂
- 属性別爆発
- 周辺ブロックの揺れ
- 低音と破裂音

## Chain
- Chain番号
- 段階ごとに音程上昇
- 5 Chain以上で軽い画面シェイク
- 8 Chain以上で背景を一瞬暗くする
- 問題文を隠さない

## 妨害
- 自陣から相手へエネルギーが移動
- 着弾予告
- 実際に相手盤面へブロックが落ちる

## 危険復帰
危険ライン直前から5 Chain以上で大幅に盤面を下げたら `CLUTCH CLEAR` を表示する。

---

# 16. ゲームテンポ

## BLITZ
- 3秒カウントダウン
- 30秒プレイ
- 結果は5秒以内に理解可能
- 「もう一戦」を最大CTA

## DUEL
- 3秒カウントダウン
- 60秒
- 残り10秒を明確表示
- 大量のランダム逆転要素は入れない
- 再戦を1クリック

---

# 17. 画面

## Landing

- ロゴ
- 「日本語を打ってブロックを爆破。連鎖で相手の盤面を埋めよう。」
- 30秒で遊ぶ
- 友達と対戦
- 音設定
- 3秒程度のルールアニメーション
- 登録要求なし

## Game HUD

- 自分の盤面
- DUELでは相手の縮小盤面
- 残り時間
- Incoming Meter
- Chain
- 入力中文章と進捗
- 危険ライン
- Ping状態

## Result

- 勝敗またはスコア
- 最大連鎖
- KPM
- 正確率
- 妨害送信数
- もう一戦
- 前回比
- 苦手傾向1件
- 招待リンク

長い学習分析を最初に見せない。

---

# 18. タイピング指標

```ts
KPM = correctKeyCount / activeTypingSeconds * 60;
accuracy =
  correctKeyCount /
  (correctKeyCount + incorrectKeyCount);
```

記録:
- 文章完成数
- Tier別速度
- ミス後復帰時間
- 最大Perfect Streak
- 苦手かな
- 苦手ローマ字遷移
- 盤面選択停止時間

外部AIは使わず統計処理する。

---

# 19. 難易度

## BLITZ

推定KPMに応じて比率調整。

初心者:
- SHORT 35%
- STANDARD 60%
- LONG 5%

上級者:
- SHORT 10%
- STANDARD 65%
- LONG 25%

## DUEL

両者の総入力負荷を近づける。

揃えるもの:
- 総モーラ数
- Tier比率
- 属性分布
- 連鎖期待値
- 妨害文章難度
- 行上昇タイミング

プライベート対戦:
- 同じ難易度
- 自動調整
を選択可能。

---

# 20. アクセシビリティ

- 属性を色と形で表示
- Reduced Motion
- Screen Shake OFF
- Flash Reduction
- High Contrast
- BGM・効果音個別OFF
- フォントサイズ調整
- キーボードでメニュー操作
- エフェクトが文章を隠さない

---

# 21. 技術構成

## Monorepo

```text
apps/
  web/
  server/
packages/
  game-core/
  typing-engine/
  phrase-content/
  shared-protocol/
  test-fixtures/
docs/
```

## Frontend

- TypeScript
- Reactでメニュー・HUD
- Canvas/WebGLで盤面
- PhaserまたはPixiJS相当の2D描画
- Web Audio API
- WebSocket
- ゲームロジックをReact componentへ直書きしない

## Backend

- TypeScript
- WebSocket room server
- 権威ゲーム状態
- ゲスト参加
- Match Seed
- 入力イベント検証
- 切断・再接続

## Game Core

```ts
interface GameCore {
  createMatch(seed: string, config: MatchConfig): MatchState;
  applyInput(state: MatchState, event: InputEvent): MatchState;
  advance(state: MatchState, deltaMs: number): MatchState;
  resolveClear(state: MatchState): ResolveResult;
  applyGarbage(state: MatchState, amount: number): MatchState;
}
```

`game-core` はDOM、描画、音、WebSocketへ依存しない。

---

# 22. 決定論

同じSeedとイベント列から同じ結果になること。

- 初期盤面
- 追加行
- 問題選択
- 属性
- 妨害位置
- ゴースト

`Math.random()` を結果へ直接使わず、Seeded PRNGを使う。

---

# 23. ネットワーク

## サーバー管理

- Match timer
- Seed
- 盤面
- 問題ID
- 行追加
- 消去
- Chain
- 攻撃
- 相殺
- 妨害着弾
- 勝敗

## Client Event

```ts
interface KeyInputEvent {
  matchId: string;
  playerId: string;
  sequence: number;
  key: string;
  clientTimeMs: number;
}
```

## Server Event

- MATCH_STARTED
- INPUT_ACCEPTED
- INPUT_REJECTED
- TARGET_LOCKED
- BLOCK_CLEARED
- CHAIN_RESOLVED
- GARBAGE_QUEUED
- GARBAGE_CANCELLED
- GARBAGE_DROPPED
- ROW_RAISED
- MATCH_ENDED
- PLAYER_DISCONNECTED
- PLAYER_RECONNECTED

## 予測

入力進捗はクライアントで即時予測。消去・Chain・攻撃はサーバー確認で確定する。クライアントも同一 `game-core` で予測してよい。

## 切断

- 8秒猶予
- 超過で切断敗北
- プライベートでは無効試合設定を将来検討

---

# 24. 不正対策

- Paste無効
- ゲーム領域外入力無効
- 不可能なKPM
- 不自然な完全一定間隔
- sequence再送
- 非表示タブ入力
- クライアントからの直接消去要求拒否
- サーバーで全文入力再検証

即BANより、疑わしい試合をランキング対象外にする。

---

# 25. データモデル

```ts
interface MatchState {
  id: string;
  seed: string;
  mode: "blitz" | "duel" | "private" | "ghost";
  phase: "waiting" | "countdown" | "playing" | "resolving" | "ended";
  remainingMs: number;
  players: Record<string, PlayerState>;
  configVersion: number;
  contentVersion: number;
}

interface PlayerState {
  id: string;
  displayName: string;
  board: BoardState;
  typing: TypingState;
  stats: LiveStats;
  incomingGarbage: number;
  outgoingGarbage: number;
  perfectStreak: number;
  disconnectedAtMs: number | null;
}

type BlockKind = "normal" | "garbage";

interface Block {
  id: string;
  kind: BlockKind;
  attribute: "fire" | "water" | "wind" | "light" | null;
  phraseId: string;
  row: number;
  column: number;
  state:
    | "idle"
    | "candidate"
    | "targeted"
    | "clearing"
    | "falling"
    | "garbage";
}
```

---

# 26. コンテンツ管理

問題文はゲームコードから分離する。

ビルド時検証:
- ID重複
- 空文字
- 読み仮名不正
- Tier不一致
- 文字数上限
- URL・メール・コード断片
- 英字のみ
- 前方一致衝突
- 読みの曖昧性
- 不適切表現

MVP目標:
- SHORT 100
- STANDARD 300
- LONG 100
- 妨害 50
- 合計550以上

Vertical Sliceでは30件でよい。

---

# 27. 保存

## ゲスト

ブラウザローカル保存:
- 設定
- 過去10試合
- ベスト
- 推定KPM
- 正確率
- 表示名

## アカウント

MVP後:
- ランキング
- 複数端末同期
- 装飾
- フレンド

初回前に登録を求めない。

---

# 28. 収益化

MVPでは不要。

将来:
- 広告なし
- 盤面テーマ
- 爆発エフェクト
- キー音
- 結果画面
- プロフィール装飾
- 詳細分析
- 学校・企業向け大会管理

Pay to Winは禁止。

---

# 29. 法的・運営

- 問題文は全て自作
- 歌詞・書籍・漫画・ニュースを転用しない
- ユーザー投稿問題はMVP外
- 自由チャットなし
- ゲーム中の入力だけ取得
- キー取得範囲と目的を明記
- 表示名、一時ID、試合イベント以外を不要に集めない

---

# 30. 実装順序

## Phase 1: Typing Engine
- かな→ローマ字受理グラフ
- 複数入力
- ミス
- 進捗
- Unit Test
- 日本語30件

## Phase 2: Local Board
- 6×10
- 4属性
- ターゲット
- 直接消去
- 重力
- 自動連鎖
- 行上昇
- 30秒BLITZ

## Phase 3: Game Feel
- 爆発
- Chain
- 音
- ヒットストップ
- シェイク
- 危険警告
- 結果

## Phase 4: Ghost
- イベント記録
- 再生
- 疑似妨害

## Phase 5: Online Duel
- ルーム
- WebSocket
- 権威状態
- ゲスト
- 妨害
- 相殺
- 再接続
- 再戦

## Phase 6: Quality
- 550文章
- アクセシビリティ
- パフォーマンス
- ブラウザQA
- 不正対策
- 負荷試験

---

# 31. 最初に作る文書

- README.md
- GAME_RULES.md
- ARCHITECTURE.md
- IMPLEMENTATION_PLAN.md
- DECISIONS.md
- CONTENT_GUIDELINES.md
- NETWORK_PROTOCOL.md
- PERFORMANCE_BUDGET.md

---

# 32. コーディング規約

- TypeScript strict
- `any`を避ける
- Game coreを純粋関数中心にする
- UIへ盤面計算を書かない
- Seeded PRNG
- Configをハードコードしない
- Network messageをschema validation
- 入力順序番号を検証
- 連鎖解決へ上限回数
- ゲームルール変更時は文書とテストを同時更新

---

# 33. テスト

## Typing Engine
- shi/si
- chi/ti
- tsu/tu
- sha/sya
- 促音
- ん
- 小文字
- カタカナ
- ミス復帰
- 複数候補
- 前方一致

## Board
- 初期4連結なし
- 直接3個
- 単独消去
- 落下
- 同時消去
- 2〜10 Chain
- 妨害隣接破壊
- 行上昇
- 危険ライン
- Seed再現

## Network
- 遅延
- 順序入替
- 再送
- 切断
- 再接続
- 不正消去
- 時間同期
- 相殺
- 同時KO

## Performance
- 60ブロック
- 大量Particle
- 10 Chain
- 妨害18個
- 低性能PC
- 30分連続
- メモリリーク
- Audio node増殖

---

# 34. 受け入れ条件

## Vertical Slice

- 日本語文章を表示
- 複数方式でローマ字入力
- 入力完了で爆発
- 同属性3個以上を直接消去
- 落下後4個以上で自動連鎖
- 5 Chain以上を再現
- 30秒BLITZが完走
- KPM・正確率・最大連鎖
- 通常60fps

## MVP

- 登録なし
- URL招待
- 60秒DUEL
- 妨害送信・相殺・着弾
- 再戦
- 標準問題は日本語中心
- 英字列・コード・ファイル名なし
- 切断処理
- 不正消去拒否
- 主要ブラウザ対応
- Reduced Motion
- 色以外でも属性識別

---

# 35. MVPで作らないもの

- キャラクター
- ストーリー
- RPG
- スキル
- 装備
- 8人対戦
- 公開チャット
- ギルド
- ランクシーズン
- スマートフォン版
- IME漢字変換
- 英文・コードモード
- ユーザー作成問題
- 生成AI
- 動画ホスティング
- 課金ガチャ

---

# 36. 最終原則

TYPE BLASTの価値は、文字入力そのものではない。

> 打ち終えた瞬間に爆発し、  
> ブロックが落ち、  
> 予想以上の連鎖が続き、  
> 相手の盤面へ妨害が雪崩れ込む。

優先順位:

1. 日本語入力が自然
2. 爆発が即時
3. 連鎖が理解できる
4. 大連鎖が気持ちいい
5. 対戦が分かりやすい
6. 上達を測れる
7. コンテンツを増やす
8. 収益化する

大連鎖が気持ちよくない状態で、機能を増やしてはならない。
