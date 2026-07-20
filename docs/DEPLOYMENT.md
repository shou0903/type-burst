# DEPLOYMENT

TYPE BLAST はバックエンドを持たない静的サイト(SPA)。ビルド成果物(`apps/web/dist`)を
配信できるホスティングであればどこでも動く。

## 推奨: Cloudflare Pages

| 項目 | 内容 |
|---|---|
| 無料枠 | **帯域無制限**、ビルド回数500回/月 |
| CDN | 世界最大級のエッジネットワーク(海外アクセスの速度が安定) |
| GitHub連携 | push で自動デプロイ、PRごとにプレビューURL発行 |
| 独自ドメイン | 無料(Cloudflareで管理しているドメインなら特に簡単) |

「世界にリリース」する上で、他の候補(Vercel/Netlify)の無料枠は帯域に上限があるため、
拡散した場合に配信停止・有料化を迫られるリスクがある。Cloudflare Pages は無料枠でも
帯域無制限のため、バズった場合の安全マージンが大きい。**この理由で第一候補として推奨する。**

### 設定値(Cloudflare Pages ダッシュボードで入力)

```
Framework preset: なし(Vite を手動選択、またはNone)
Build command:    npm run build
Build output directory: apps/web/dist
Root directory:   / (リポジトリルート。npm workspaces のため)
Node version:     20
```

### 手順

1. https://dash.cloudflare.com にアカウント作成(無料)
2. Workers & Pages → Create → Pages → GitHubと連携
3. このリポジトリを選択
4. 上記の設定値を入力してデプロイ
5. 発行された `*.pages.dev` のURLで動作確認

### 補足: `wrangler.toml` が必要な理由

Cloudflareの新しい統合UI(Workers & Pages)で作成したプロジェクトは、デプロイ時に
`npx wrangler deploy` を自動実行する場合がある。このリポジトリはnpm workspacesの
モノレポ構成のため、`wrangler` がリポジトリルートで対象を見失い、以下のエラーで
失敗することがある。

```
✘ [ERROR] The Cloudflare application detection logic has been run in the root
  of a workspace instead of targeting a specific project.
```

これを防ぐため、リポジトリルートに `wrangler.toml` を置き、Pagesの出力先を明記している。

```toml
name = "type-blast"
pages_build_output_dir = "apps/web/dist"
compatibility_date = "2026-07-20"
```

このファイルがあれば `wrangler deploy` はモノレポルートでも迷わず
`apps/web/dist` をPagesとしてデプロイする。

## 代替: Vercel

DXの滑らかさ(プレビューデプロイ・ダッシュボード)を優先するならこちら。
設定値は同様(Build command: `npm run build`、Output: `apps/web/dist`)。
無料枠(Hobby プラン)は帯域上限あり(個人利用なら通常問題にならない水準)。

## 代替: Netlify

Vercel とほぼ同等。`netlify.toml` を使う場合:

```toml
[build]
  command = "npm run build"
  publish = "apps/web/dist"
```

## デプロイ前チェックリスト

- [ ] `npm run typecheck && npm test && npm run build` がローカルで成功する
- [ ] `docs/DECISIONS.md` の運営者名・連絡先プレースホルダーを実際の情報に置き換える
  (`apps/web/public/privacy.html` / `terms.html` 内の `[運営者名 未設定]` 等)
- [ ] カスタムドメインを使う場合、`index.html` の OGP タグに `og:url` / `og:image` を追加
- [ ] デプロイ後のURLで実際にプレイし、Canvas・音声・キーボード入力を確認

## 継続的デプロイ

`main`(または `master`)へのpushで自動デプロイされる(Cloudflare Pages/Vercel/Netlifyいずれも標準機能)。
`.github/workflows/ci.yml` がテスト・型チェック・ビルドをPRごとに実行するため、
デプロイ前に壊れた変更を検知できる。
