# DEPLOYMENT

TYPE BLAST は静的サイト(SPA)+ ランキング機能用のVercel Serverless Functionsで構成される
(D-026)。ゲーム本体はバックエンド不要だが、世界ランキングのみサーバー(`apps/web/api/scores.ts`)
とデータストア(Vercel KV)を使用する。

## 現在の本番環境

- **URL:** https://type-blast-web.vercel.app/
- **ホスティング:** Vercel
- **リポジトリ:** https://github.com/shou0903/type-blast(`master` ブランチへのpushで自動デプロイ)

### Vercel設定値

```
Root Directory:  apps/web
Framework Preset: Vite(自動検出)
Build Command:    npm run build
Output Directory: dist
```

Vercelはnpm workspacesモノレポの検出が優秀で、Root Directoryを`apps/web`に設定するだけで
リポジトリルートから正しく依存解決してビルドできる。

### ランキング機能に必要な設定(Vercel KV)

世界ランキング機能(D-026)を動かすには、Vercel KVを有効化してプロジェクトに接続する必要がある。

1. Vercelダッシュボード → 対象プロジェクト → **Storage** タブ
2. **Create Database** → **KV**(Upstash Redis) を選択
3. データベース名を入力して作成(例: `type-blast-ranking`)
4. 作成後の画面で、対象プロジェクト(`type-blast-web`)に **Connect** する
5. 接続すると `KV_REST_API_URL` / `KV_REST_API_TOKEN` 等の環境変数が自動で追加される
6. 再デプロイ(masterへの次のpushで自動、または「Redeploy」ボタン)すれば `/api/scores` が動作する

これを行わないと `/api/scores` へのアクセスはエラーになるが、ゲーム本体(サバイバル・CPU対戦)には
一切影響しない(ランキング画面が「取得できませんでした」と表示されるだけ)。

### 広告(Google AdSense)を有効化する手順

1. https://www.google.com/adsense/ でアカウント作成・サイト審査を申請(運営者自身の対応が必要)
2. 審査通過後、`apps/web/src/adsConfig.ts` の3つのプレースホルダーを実際の値に書き換える:
   - `ADSENSE_CLIENT_ID`(`ca-pub-` で始まるパブリッシャーID)
   - `AD_SLOT_LEFT` / `AD_SLOT_RIGHT`(AdSense管理画面で作成した広告ユニットのスロットID。
     縦長バナー160×600、または類似サイズを2つ作成する)
3. commit・pushすれば自動デプロイされる
4. プレースホルダーのままだと広告は一切読み込まれない(安全側のデフォルト、D-027)

## 経緯: Cloudflare Pagesを試して断念した理由(D-025)

当初 Cloudflare Pages(無料枠が帯域無制限で世界配信に有利)を第一候補として試したが、
以下の理由で3段階連続でつまずき、Vercelに切り替えた。

1. **モノレポのワークスペース検出エラー**: Cloudflareの新しい統合UI(Workers Builds)は
   デプロイ時に `npx wrangler deploy` を自動実行するが、npm workspacesのルートで実行すると
   「application detection logic has been run in the root of a workspace」で失敗する。
   → Deploy commandを `npx wrangler pages deploy apps/web/dist --project-name=<name>` に
   明示的に書き換えることで回避可能(wrangler.tomlの`pages_build_output_dir`だけでは
   解決しなかった)。
2. **APIトークンの権限不足**: `CLOUDFLARE_API_TOKEN` に `Cloudflare Pages: Edit` 権限が
   付与されていないと認証エラーになる。
3. **ビルドトークン自体の不具合**: 上記を全て修正しても
   「build token that belongs to a user who has left your organization」という
   Cloudflare側の内部エラーが再現し続け、UIから提示された修正手順(Settings → Builds →
   API token の再作成)を試しても解消しなかった。原因はこちらのコード側ではなく
   Cloudflare側の内部状態と判断し、深追いせず撤退した。

**教訓:** モノレポ + Cloudflareの新しいWorkers Builds系パイプラインの組み合わせは
現状かなり脆い。単純な静的サイトのモノレポなら、最初からVercelかNetlifyの方が
迷わずデプロイできる可能性が高い。将来的にCloudflareの無料枠(帯域無制限)を
活かしたくなった場合は、`apps/web` を独立リポジトリとして切り出す、または
Cloudflareのサポートに問い合わせてから再挑戦するのが無難。

`wrangler.toml` はリポジトリルートに残してあるが、現在の本番デプロイ(Vercel)では
使用していない。

## 代替候補

### Cloudflare Pages(帯域無制限だが上記の注意点あり)

| 項目 | 内容 |
|---|---|
| 無料枠 | 帯域無制限、ビルド回数500回/月 |
| CDN | 世界最大級のエッジネットワーク |
| 注意 | 上記「経緯」参照。モノレポでの再挑戦は Deploy command を明示指定すること |

### Netlify

Vercelとほぼ同等。`netlify.toml` を使う場合:

```toml
[build]
  base = "apps/web"
  command = "npm run build"
  publish = "dist"
```

## デプロイ前チェックリスト(今後の変更時)

- [ ] `npm run typecheck && npm test && npm run build` がローカルで成功する
- [ ] masterへpushすると、Vercelが自動でビルド・デプロイする(GitHub連携済み)
- [ ] `.github/workflows/ci.yml` がPRごとにテスト・型チェック・ビルドを実行する
- [ ] デプロイ後のURLで実際にプレイし、Canvas・音声・キーボード入力を確認

## カスタムドメインを追加する場合

1. Vercelプロジェクト → Settings → Domains でドメインを追加
2. ドメインのDNS設定でVercelが指示するレコード(A/CNAME)を追加
3. `apps/web/index.html` のOGPタグに `og:url` を追加(現在は未設定)
