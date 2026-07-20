# DEPLOYMENT

TYPE BLAST はバックエンドを持たない静的サイト(SPA)。ビルド成果物(`apps/web/dist`)を
配信できるホスティングであればどこでも動く。

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
