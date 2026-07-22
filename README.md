# TYPE BURST

日本語が書かれたブロックをローマ字入力で爆破し、同色ブロックの落下連鎖を起こすブラウザゲーム。

> 普通に面白い連鎖パズルを遊んでいたら、結果として日本語タイピングが速くなる。

**🎮 公開中: https://type-burst-web.vercel.app/**

> **🤖 このコードを触るAI/開発者へ:** 作業を始める前に必ず [docs/HANDOVER.md](docs/HANDOVER.md)
> を読むこと。絶対に破ってはいけないルール・現在の状態・並行作業の注意・環境特有の制約が
> まとまっている。

実装の正本は [TYPE_BURST_Product_Game_Technical_Spec_v1.0.md](TYPE_BURST_Product_Game_Technical_Spec_v1.0.md)
だが、以後の変更・決定事項は [docs/DECISIONS.md](docs/DECISIONS.md) が優先する(末尾が最新)。
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

サバイバル・CPU対戦・チュートリアル・世界ランキング・称号システム・成長グラフ・
タイピング分析・モバイル流入ランディングまで実装済み。**正確な最新状況は
[docs/DECISIONS.md](docs/DECISIONS.md) を末尾から遡って確認すること**
([docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) のPhase表はここしばらく更新が
止まっている)。オンライン1対1対戦(Phase 5)は未着手。
