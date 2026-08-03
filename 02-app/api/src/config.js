// 設定の一元管理。重みづけ定数は 00-docs/draft/03.weight-algorithm.md の
// チューニング表に対応する（マジックナンバーをコードに散らさない）。

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL
    || 'postgres://eyeg:eyeg@localhost:5432/eyeg_stack',

  // アプリの公開URL（末尾スラッシュなし）。メール文面の案内等に使う
  appBaseUrl: (process.env.APP_BASE_URL || 'http://localhost:8080').replace(/\/+$/, ''),

  // Resend。キー未設定時は送信せずサーバログにコードを出す（開発用フォールバック）
  resendApiKey: process.env.RESEND_API_KEY || '',
  mailFrom: process.env.MAIL_FROM || 'EyeG-Stack <onboarding@resend.dev>',

  // ログインコード（6桁）: 有効期限・1コードあたりの試行上限
  loginCodeTtlMin: Number(process.env.LOGIN_CODE_TTL_MIN || 10),
  loginCodeMaxAttempts: Number(process.env.LOGIN_CODE_MAX_ATTEMPTS || 5),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),

  // nginx を介さずローカルで動かすとき web/ を直接配信する
  serveStatic: process.env.SERVE_STATIC === '1',
};

// 重みづけ定数（チューニング表）
export const WEIGHT = {
  W_DUE: 0.30,
  W_IMP: 0.20,
  W_CAT: 0.15,
  W_FRESH: 0.15,
  W_VIEW: 0.05,
  W_MAN: 0.15,

  DUE_HORIZON_DAYS: 7,
  IMP_UNSET: 0.4,
  FRESH_HALF_LIFE_H: 24,
  VIEW_CAP: 100,
  VIEW_DEDUP_MIN: 60,
  MAN_SCALE: 5,
  MAN_HALF_LIFE_D: 21,
  CAT_BLEND_MIN: 60,

  // カテゴリ×時間帯のルール表（ファジィルールの後件部）
  CAT_MATRIX: {
    day:     { work: 1.0, general: 0.6, personal: 0.3 },
    night:   { work: 0.4, general: 0.6, personal: 1.0 },
    weekend: { work: 0.2, general: 0.7, personal: 1.0 },
  },
};

export const CATEGORIES = ['personal', 'work', 'general'];

export const DEFAULT_LABELS = {
  personal: '私用',
  work: '仕事用',
  general: '一般',
};
