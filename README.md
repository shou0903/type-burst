# TYPE BLAST

日本語が書かれたブロックをローマ字入力で爆破し、同色ブロックの落下連鎖を起こす30秒ブラウザゲーム。

> 普通に面白い連鎖パズルを遊んでいたら、結果として日本語タイピングが速くなる。

実装の正本は [TYPE_BLAST_Product_Game_Technical_Spec_v1.0.md](TYPE_BLAST_Product_Game_Technical_Spec_v1.0.md)。
仕様からの変更・決定事項は [docs/DECISIONS.md](docs/DECISIONS.md) に記録する。
公開手順は [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) を参照。

## 遊び方

1. 消したいブロックの日本語をローマ字で入力する(最初のキーで候補が光る)
2. 入力完了でブロックが爆発。同属性が上下左右に3個以上つながっていれば全部消える
3. 落下後に同属性4個以上がつながると自動連鎖
4. ゲージが満タンになったら **Enter** で TYPE BURST(下3行を吹き飛ばす)
5. 💣ボム(3×3爆破)・🌈プリズム(同色全消し)の特殊ブロックも活用する
6. 新しいブロックは上から降ってくる。積み上がって盤面があふれたら終了
7. 選択のやり直しは **Esc / Backspace**。全消しで ALL CLEAR ボーナス!

**モード:** サバイバル(1人・時間制限なし)/ CPU対戦(妨害の送り合い、難易度3段階)

日本語IMEはOFF(半角英数)にしてプレイする。

## セットアップ

```bash
npm install
npm run dev        # 開発サーバー(apps/web)
npm test           # 全ユニットテスト
npm run typecheck  # TypeScript 型チェック
npm run build      # 本番ビルド
```

## 構成

```text
apps/
  web/               React + Canvas 2D + Web Audio のフロントエンド
packages/
  typing-engine/     かな→ローマ字受理グラフ(shi/si・促音・ん などの複数表記対応)
  game-core/         盤面・消去・連鎖・行上昇・BLITZ の純ロジック(DOM非依存・決定論)
  phrase-content/    日本語問題データと検証
docs/                ゲームルール・アーキテクチャ等のドキュメント
```

## 現在の状態

v2(サバイバル+CPU対戦)実装済み。詳細は [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)。

- ✅ Phase 1: Typing Engine
- ✅ Phase 2: Local Board(サバイバル。時間制限なし、D-012)
- ✅ Phase 3: Game Feel(爆発・連鎖演出・効果音・バースト・フラッシュ)
- ✅ Phase 3.5: 特殊ブロック(ボム/プリズム)+ TYPE BURST(D-013)
- ✅ Phase 4 相当: CPU対戦(妨害送信・相殺・着弾が稼働、D-014)
- ⬜ Phase 5: Online Duel
- ⬜ Phase 6: Quality(550文章・アクセシビリティ拡充・負荷試験)
