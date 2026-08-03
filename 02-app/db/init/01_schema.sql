-- EyeG-Stack schema (00-docs/draft/02.data-model.md 準拠)
-- 認証はメールアドレスのみのマジックリンク方式のため、
-- login_id / password_hash は持たない（認証モジュール所有のテーブルは auth_ プレフィックス）。

-- ============================================================
-- users
-- ============================================================
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  display_name  VARCHAR(255),
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 認証モジュール所有（他モジュールは users.id FK のみで連携）
-- ============================================================

-- ログイン用ワンタイムコード（6桁）。
-- ユーザー作成は verify 成功時（未確認メールのゴミユーザーを作らない）。
-- code_hash は email と対で照合する（6桁と短いためコード単独では列挙を許さない）。
-- attempts で総当りを抑止し、上限超過で該当行を無効化する。
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

CREATE TABLE auth_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id);

-- ============================================================
-- category_labels — 固定3カテゴリの表示名カスタム
-- ============================================================
CREATE TABLE category_labels (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(20) NOT NULL CHECK (category IN ('personal', 'work', 'general')),
  label    VARCHAR(50) NOT NULL,
  UNIQUE (user_id, category)
);

-- ============================================================
-- memos
-- ============================================================
-- due_at は DATE。UI が日付入力であり、重みづけ仕様（03.weight-algorithm.md）が
-- 「ユーザーTZにおける期限日の終わり」を読み取り時に解決するため、
-- 日付のまま保持するのが最も忠実（02.data-model.md からの意図的な変更）。
CREATE TABLE memos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body              TEXT NOT NULL DEFAULT '',
  category          VARCHAR(20) NOT NULL CHECK (category IN ('personal', 'work', 'general')),
  importance        SMALLINT CHECK (importance BETWEEN 1 AND 5),
  due_at            DATE,
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  view_count        INTEGER NOT NULL DEFAULT 0,
  last_viewed_at    TIMESTAMPTZ,
  manual_up_count   INTEGER NOT NULL DEFAULT 0,
  manual_down_count INTEGER NOT NULL DEFAULT 0,
  last_manual_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memos_user_created ON memos (user_id, created_at DESC);

-- ============================================================
-- memo_photos — 1メモ最大4枚、order 0-3
-- ============================================================
CREATE TABLE memo_photos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memo_id    UUID NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  "order"    SMALLINT NOT NULL CHECK ("order" BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (memo_id, "order")
);
