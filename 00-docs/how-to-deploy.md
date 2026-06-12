# EyeG-Stack デプロイ手順（eyeg-stack.snkk.net）

最終更新: 2026-06-12

さくらVPS（snkk.net）の既存構成に同居させる。VPS のフロント nginx
（`~/nginx`、Docker）が TLS 終端・全サブドメイン集約を担い、nginx は
**フロントの1段のみ**。EyeG-Stack 側は api + db の2コンテナだけ動かす。

```
ブラウザ
  → フロント nginx（~/nginx、外部ネットワーク proxy）
      静的配信: /var/www/html/eyeg-stack/   （= ~/nginx/www/eyeg-stack/）
      /api/   : → eyeg-stack-api:3000（proxy ネットワーク経由）
                  → eyeg-stack-db（internal ネットワーク、外部非公開）
```

## サーバー側ディレクトリ構成

既存アプリ（`~/nginx` / `~/n8n`）と同じく、**ホーム直下の固定ディレクトリ**に
置き、リリース時は同じ場所に上書き転送する（日付ディレクトリ等は作らない）。
リポジトリの `02-app/` という名前はローカルの整理用なので、サーバーには
**`02-app/` 直下の中身**を展開する。

```
~/eyeg-stack/                ← 02-app/ 直下の中身
├── api/                     ← API ビルド元
├── db/                      ← DB 初期化 SQL（初回起動時に自動適用）
├── web/                     ← 静的ファイル（→ ~/nginx/www/eyeg-stack/ へコピー）
└── vps/                     ← VPS 用 compose・nginx テンプレート
    └── .env                 ← 本番設定（転送で上書きしない・git 管理外）
```

※ `nginx/` とルートの `docker-compose.yml` / `.env` はローカル開発専用。
転送から除外してよい（あっても VPS では使われない）。
`api/node_modules/` は除外する（イメージビルド時にコンテナ内で npm install される）。

---

## 初回セットアップ

### 1. DNS

`eyeg-stack.snkk.net` の A レコードを VPS の IP に追加する。
（証明書取得の前に DNS が引けるようになっている必要がある）

### 2. フロント nginx にテンプレート追加

ACME チャレンジを受けるため、証明書拡張より先に入れる
（443 ブロックは既存の snkk.net 証明書を参照するので、この時点でも起動できる）。

```sh
cp ~/eyeg-stack/vps/eyeg-stack.conf.template ~/nginx/templates/
cd ~/nginx
docker compose restart nginx
```

### 3. 証明書の拡張

snkk.net の単一証明書に SAN を追加する。**`-d` には既存の全ドメインを
並べること** — 漏れたドメインは証明書から外れる。

> 注意: 現在の対象は renewal conf（`~/nginx/certbot/conf/renewal/snkk.net.conf`
> の `[[webroot_map]]`）が古い場合があるので、実際の証明書の SAN で確認する:
>
> ```sh
> echo | openssl s_client -connect snkk.net:443 -servername snkk.net 2>/dev/null \
>   | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"
> ```

```sh
cd ~/nginx
docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
  -d snkk.net -d www.snkk.net -d api.snkk.net \
  -d ai.snkk.net -d eyeg-stack.snkk.net --expand
docker compose restart nginx
```

（2026-06-12 実施済み。有効期限 2026-09-10、以降は通常の更新フローに乗る）

### 4. 資材の転送

ローカルの `02-app/` 直下を `~/eyeg-stack/` へ転送する。例（rsync）:

```sh
rsync -av --delete --exclude node_modules --exclude nginx \
  --exclude docker-compose.yml --exclude .env --exclude 'vps/.env' \
  02-app/ ubuntu@153.127.32.181:~/eyeg-stack/
```

### 5. .env の作成

```sh
cd ~/eyeg-stack/vps
cp .env.example .env
vim .env
```

| 変数 | 値 |
|------|-----|
| `POSTGRES_PASSWORD` | 任意の強いパスワード（必須） |
| `APP_BASE_URL` | `https://eyeg-stack.snkk.net` — **必ず https**。マジックリンクに載る |
| `RESEND_API_KEY` | Resend の API キー（必須。未設定だとメールがログ出力のみ） |
| `MAIL_FROM` | `EyeG-Stack <no-reply@snkk.net>` 等。Resend で認証済みドメインの差出人にする |

※ Resend は `snkk.net` をドメイン認証済み（2026-05-27、Tokyo リージョン）。
サブドメイン差出人（`@eyeg-stack.snkk.net`）でエラーが出る場合は `@snkk.net` にする。

### 6. アプリの起動（api + db）

```sh
cd ~/eyeg-stack/vps
docker compose up -d --build
```

compose は **カレントディレクトリの docker-compose.yml と .env を読む**ため、
必ず `~/eyeg-stack/vps/` から実行する。`build: ../api` / `../db/init` の
相対参照で隣のディレクトリがビルド元になる。

DB データは名前付きボリューム（`vps_pgdata`）に入る。

> **鉄則: `docker compose down -v` は使わない。** `-v` はボリュームごと
> 削除するため DB のデータが消える。止めるだけなら `docker compose down`。

### 7. 静的ファイルの配置

```sh
mkdir -p ~/nginx/www/eyeg-stack
cp -r ~/eyeg-stack/web/. ~/nginx/www/eyeg-stack/
```

`web/` の**中身**（index.html / push.html / check.html / login.html / assets/）が
`~/nginx/www/eyeg-stack/` 直下に並ぶこと。`api/` 等のソースコードをここに
置かないこと（nginx がそのまま配信してしまう）。

### 8. 動作確認

```sh
curl https://eyeg-stack.snkk.net/api/health    # → {"ok":true}
```

ブラウザで https://eyeg-stack.snkk.net を開き、

1. ログイン（メールアドレス入力 → マジックリンク受信 → クリック）
2. Push でメモ作成（写真付きも 1 件試す — 413 が出ないこと）
3. Check で一覧・詳細・並べ替え

を確認する。

---

## リリース（更新）手順

**リリースのたびにリビジョン（パッチ番号）を上げる。** 現在 v0.1.1。

1. `02-app/web/` 4ページの `.app-version`（`v0.1.x` 表記）を更新
2. `cd 02-app/api && npm version 0.1.x --no-git-tag-version`
   （package.json と package-lock.json が同時に更新される。lock を忘れると
   イメージビルドの `npm ci` が不整合で失敗する）

その後、手順4の rsync を再実行 → 変更箇所に応じて反映するだけ。`down` は不要
（compose が同一プロジェクト `vps` として差分だけ作り直す）。
`vps/.env` は rsync の exclude で保護されているので毎回の作成は不要。

- **API のコード更新**:
  ```sh
  cd ~/eyeg-stack/vps && docker compose up -d --build api
  ```
- **フロントエンド更新**: 手順7の cp を再実行するだけ（コンテナ再起動不要）
- **DB スキーマ変更**: `db/init/` は**初回起動時のみ**適用される。既存 DB への
  変更は psql で手動適用（マイグレーション運用は今後の課題）
- **nginx 設定変更**: テンプレートを差し替えて `~/nginx` で
  `docker compose restart nginx`

## トラブルシューティング

- **マジックリンクのメールが届かない**: `docker logs eyeg-stack-api` を確認。
  - `RESEND_API_KEY 未設定のためログ出力のみ` → .env 未設定。ログに出た URL を
    直接開けばログイン自体は可能（開発フォールバック）
  - `Resend API error 403` 等 → MAIL_FROM のドメイン未認証。`@snkk.net` にする
- **写真付き Push が 413**: フロント nginx に `client_max_body_size 12m` が
  効いているか確認（テンプレート反映漏れ・restart 忘れ）。
- **Cookie が効かずログインループ**: `X-Forwarded-Proto` が https で届いているか。
  プロキシ1段なら `$scheme` のままで正しい。API は `trust proxy: 1` 前提。
- **db に外から繋がらない**: 仕様（internal ネットワーク）。メンテは
  `docker exec -it eyeg-stack-db psql -U eyeg -d eyeg_stack`。

## 補足: compose とディレクトリの関係

- コンテナは Docker デーモンが動かしており、compose ファイルは「指示書」。
  実行中のコンテナは compose ファイルの場所に依存しない。
- ただし compose の**プロジェクト名はディレクトリ名**（ここでは `vps`）由来。
  同じ `~/eyeg-stack/vps/` から実行し続ける限り、コンテナ・ボリュームは
  同一プロジェクトとして管理される。
- ロールバックはローカルのリポジトリから旧バージョンを再転送して `up --build`。
  サーバー側にスナップショットは持たない。
