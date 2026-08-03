// 認証モジュール（疎結合）。
// メールアドレスのみの 6桁コード方式:
//   POST /request-code → ワンタイムコード（6桁）を発行しメール送信
//   POST /verify-code  → email+code 検証成功でユーザー作成（初回）+ セッション Cookie 発行
// 他モジュールへの提供物は requireAuth ミドルウェア（req.user を載せる）のみ。
// users テーブルへの依存は FK だけに保ち、将来 OAuth 等へ差し替え可能にする。

import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { config } from '../config.js';
import { sendLoginCode } from '../mailer.js';

export const authRouter = Router();

const COOKIE_NAME = 'eyeg_session';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
// 6桁の数値コード（000000-999999）。crypto の一様乱数で先頭ゼロも許容する。
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;

// 簡易レート制限（メールアドレス単位 60秒 / IP 単位 10回・時）
const lastSentByEmail = new Map();
const sentByIp = new Map();

function rateLimited(email, ip) {
  const now = Date.now();
  const last = lastSentByEmail.get(email);
  if (last && now - last < 60_000) return true;

  const hits = (sentByIp.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (hits.length >= 10) return true;

  lastSentByEmail.set(email, now);
  hits.push(now);
  sentByIp.set(ip, hits);
  return false;
}

// --- ログインコード要求 -------------------------------------------------
authRouter.post('/request-code', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 255) {
    return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
  }
  if (rateLimited(email, req.ip)) {
    return res.status(429).json({ error: '送信間隔が短すぎます。しばらく待ってから再度お試しください' });
  }

  // 同一メールの未使用コードは無効化してから新規発行（有効なコードは常に1つ）
  await query(
    `UPDATE auth_login_codes SET used_at = now()
      WHERE email = $1 AND used_at IS NULL`,
    [email],
  );

  const code = newCode();
  const expiresAt = new Date(Date.now() + config.loginCodeTtlMin * 60_000);
  await query(
    `INSERT INTO auth_login_codes (email, code_hash, expires_at) VALUES ($1, $2, $3)`,
    [email, sha256(code), expiresAt],
  );

  try {
    await sendLoginCode(email, code);
  } catch (err) {
    console.error('[auth] メール送信失敗:', err.message);
    return res.status(502).json({ error: 'メールを送信できませんでした。時間をおいて再度お試しください' });
  }

  res.json({ ok: true });
});

// --- コード検証（email + code を受け取り検証） --------------------------
authRouter.post('/verify-code', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  if (!EMAIL_RE.test(email) || !CODE_RE.test(code)) {
    return res.status(400).json({ error: 'メールアドレスまたはコードの形式が正しくありません' });
  }

  // 該当メールの有効な最新コード行を取得（使用済み・期限切れ・試行超過は除外）
  const { rows } = await query(
    `SELECT id, code_hash, attempts FROM auth_login_codes
      WHERE email = $1 AND used_at IS NULL AND expires_at > now()
        AND attempts < $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [email, config.loginCodeMaxAttempts],
  );
  const invalid = () =>
    res.status(401).json({ error: 'コードが正しくないか、期限が切れています' });
  if (!rows.length) return invalid();

  const row = rows[0];
  // 一致・不一致に関わらず試行回数を加算。不一致なら上限まで再試行可
  if (sha256(code) !== row.code_hash) {
    await query(`UPDATE auth_login_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return invalid();
  }

  // 一致 → このコードを使用済みにする
  await query(`UPDATE auth_login_codes SET used_at = now() WHERE id = $1`, [row.id]);

  // 初回ならユーザー作成（メール確認が取れたこの時点で作る）
  const userRes = await query(
    `INSERT INTO users (email, last_login_at)
     VALUES ($1, now())
     ON CONFLICT (email) DO UPDATE SET last_login_at = now()
     RETURNING id`,
    [email],
  );
  const userId = userRes.rows[0].id;

  const sessionToken = newToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000);
  await query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, sha256(sessionToken), expiresAt],
  );

  res.cookie(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: config.sessionTtlDays * 86_400_000,
    path: '/',
  });
  res.json({ ok: true });
});

// --- セッション必須ミドルウェア -----------------------------------------
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'ログインが必要です' });

    const { rows } = await query(
      `UPDATE auth_sessions
          SET last_used_at = now()
        WHERE token_hash = $1 AND expires_at > now()
        RETURNING user_id`,
      [sha256(token)],
    );
    if (!rows.length) return res.status(401).json({ error: 'セッションの有効期限が切れています' });

    const userRes = await query(
      `SELECT id, email, display_name FROM users WHERE id = $1`,
      [rows[0].user_id],
    );
    if (!userRes.rows.length) return res.status(401).json({ error: 'ユーザーが見つかりません' });

    req.user = userRes.rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

// --- 自分の情報 ----------------------------------------------------------
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// --- ログアウト ----------------------------------------------------------
authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    await query(`DELETE FROM auth_sessions WHERE token_hash = $1`, [sha256(token)]);
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});
