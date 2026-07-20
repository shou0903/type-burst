# TYPE BLAST — Coding AI Starter Prompt

あなたはシニアWebゲームエンジニアとして、ブラウザゲーム「TYPE BLAST」を実装してください。

`TYPE_BLAST_Product_Game_Technical_Spec_v1.0.md` を実装の正本として扱ってください。

## 一文説明

日本語文章が書かれたブロックをローマ字入力で爆破し、同色ブロックの落下連鎖を起こして相手へ妨害を送る、30〜60秒の短時間対戦ゲームです。

## 絶対条件

- 標準問題は自然な日本語
- 英字だけの文字列、日付文字列、ファイル名、コード断片を標準問題に入れない
- 日本語はローマ字入力
- shi/si、chi/ti、促音、ん等の一般的な複数入力を許容
- 格闘ゲームやRPGへ変更しない
- まず30秒BLITZを完成
- 直接3個以上消去、落下後4個以上自動連鎖を仕様どおり実装
- Seedとイベントから再現可能
- game-coreとtyping-engineを独立package化
- 外部AI APIを使わない
- キャラクター、ストーリー、スキル、課金を追加しない

## 最初に作る文書

1. IMPLEMENTATION_PLAN.md
2. DECISIONS.md
3. ARCHITECTURE.md
4. GAME_RULES.md
5. CONTENT_GUIDELINES.md
6. NETWORK_PROTOCOL.md
7. PERFORMANCE_BUDGET.md

## Vertical Slice

1. TypeScript monorepo
2. typing-engine
3. 日本語問題30件
4. 6×10ローカル盤面
5. 4属性
6. キーボードによるターゲット選択
7. 入力完了時の爆発
8. 直接同色消去
9. 重力落下
10. 4個以上の自動連鎖
11. 行上昇
12. 30秒BLITZ
13. KPM・正確率・最大連鎖
14. Unit Test
15. 実ブラウザ確認

初期段階では仮の四角形と簡単な効果音で構いません。ゲームルールが安定する前に高度なアート制作へ進まないでください。

不明点で止まらず、仕様の優先順位に従って最小かつ安全な仮定を置き、DECISIONS.mdへ記録してください。
