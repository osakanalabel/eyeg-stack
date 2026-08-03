-- 001: auth_login_tokens（マジックリンク）→ auth_login_codes（6桁コード）移行
--
-- 適用対象: v0.1.6 以前の稼働 DB。マジックリンク方式から 6桁コード方式への
-- 認証変更に伴い、テーブル名・カラム構成を変える。
--
-- 旧方式のトークン行（token_hash）は新方式では使えないため破棄してよい。
-- そのため DROP → CREATE で作り直す（DATA を保持する意味がない）。
--
-- 適用: docker exec -i eyeg-stack-db psql -U eyeg -d eyeg_stack < 001_login_tokens_to_codes.sql
-- ロールバックは v0.1.6 のスキーマに戻すこと（このマイグレーションに down は用意しない）。

BEGIN;

DROP TABLE IF EXISTS auth_login_tokens;

CREATE TABLE auth_login_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      VARCHAR(255) NOT NULL,
  code_hash  TEXT NOT NULL,
  attempts   SMALLINT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_login_codes_email ON auth_login_codes (email);

COMMIT;
