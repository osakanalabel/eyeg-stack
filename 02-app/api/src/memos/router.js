// メモ API。
// Push = effect（作成・編集・削除）/ Check = output（一覧・詳細）。
// 例外として view カウント・手動順位カウントは output 側のチューニングとして
// ここで更新するが、updated_at は動かさない（鮮度ループ防止。03.weight-algorithm.md）。

import { Router } from 'express';
import { query, pool } from '../db.js';
import { CATEGORIES, WEIGHT } from '../config.js';
import { sortByWeight } from './weight.js';

export const memosRouter = Router();

const MAX_BODY_LEN = 10_000;
const MAX_PHOTOS = 4;
const MAX_PHOTO_B64 = 2_000_000; // 長辺1024px縮小済みJPEG想定で十分な上限
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// :id が UUID でないと Postgres がパースエラー（500）になるため、ここで弾く
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
memosRouter.param('id', (req, res, next, id) => {
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'メモが見つかりません' });
  next();
});

const LIST_COLUMNS = `
  m.id, m.body, m.category, m.importance, m.due_at,
  m.latitude, m.longitude,
  m.view_count, m.manual_up_count, m.manual_down_count, m.last_manual_at,
  m.created_at, m.updated_at,
  (SELECT count(*)::int FROM memo_photos p WHERE p.memo_id = m.id) AS photo_count
`;

// --- バリデーション -------------------------------------------------------

function validateMemoInput(body) {
  const out = {};

  const text = typeof body.body === 'string' ? body.body : '';
  if (text.length > MAX_BODY_LEN) return { error: 'メモが長すぎます' };
  out.body = text;

  if (!CATEGORIES.includes(body.category)) return { error: 'カテゴリが不正です' };
  out.category = body.category;

  if (body.importance == null) {
    out.importance = null;
  } else {
    const imp = Number(body.importance);
    if (!Number.isInteger(imp) || imp < 1 || imp > 5) return { error: '重要度は1〜5です' };
    out.importance = imp;
  }

  if (!body.due_at) {
    out.due_at = null;
  } else if (DATE_RE.test(String(body.due_at))) {
    out.due_at = String(body.due_at);
  } else {
    return { error: '期限の形式が正しくありません' };
  }

  for (const key of ['latitude', 'longitude']) {
    if (body[key] == null) {
      out[key] = null;
    } else {
      const v = Number(body[key]);
      if (!Number.isFinite(v)) return { error: 'GPS座標が不正です' };
      out[key] = v;
    }
  }

  if (body.photos !== undefined) {
    if (!Array.isArray(body.photos) || body.photos.length > MAX_PHOTOS) {
      return { error: `写真は最大${MAX_PHOTOS}枚です` };
    }
    const photos = [];
    for (const p of body.photos) {
      // data URL で来ても raw base64 で保存する（データモデル準拠）
      const b64 = String(p).replace(/^data:image\/(jpeg|png|webp);base64,/, '');
      if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length > MAX_PHOTO_B64) {
        return { error: '写真データが不正です' };
      }
      photos.push(b64);
    }
    out.photos = photos;
  }

  return { value: out };
}

async function replacePhotos(client, memoId, photos) {
  await client.query(`DELETE FROM memo_photos WHERE memo_id = $1`, [memoId]);
  for (let i = 0; i < photos.length; i++) {
    await client.query(
      `INSERT INTO memo_photos (memo_id, data, "order") VALUES ($1, $2, $3)`,
      [memoId, photos[i], i],
    );
  }
}

// --- 一覧（Check / output） ----------------------------------------------
// view=recommended は IANA タイムゾーン（tz=Asia/Tokyo 等）必須相当。
// 不正・未指定時は UTC で計算する。
memosRouter.get('/', async (req, res) => {
  const view = String(req.query.view || 'recommended');
  const { rows } = await query(
    `SELECT ${LIST_COLUMNS} FROM memos m WHERE m.user_id = $1`,
    [req.user.id],
  );

  if (view === 'newest') {
    rows.sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at) ||
      String(a.id).localeCompare(String(b.id)));
    return res.json({ memos: rows });
  }

  if (view === 'category') {
    // 一般 → 仕事用 → 私用（Check モックのフィードバックで確定した順）
    const order = { general: 0, work: 1, personal: 2 };
    rows.sort((a, b) =>
      order[a.category] - order[b.category] ||
      new Date(b.created_at) - new Date(a.created_at) ||
      String(a.id).localeCompare(String(b.id)));
    return res.json({ memos: rows });
  }

  // recommended（重みづけ）
  let tz = String(req.query.tz || 'UTC');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const sorted = sortByWeight(rows, { now: new Date(), tz });
  res.json({ memos: sorted });
});

// --- 作成（Push / effect） ------------------------------------------------
memosRouter.post('/', async (req, res) => {
  const { error, value } = validateMemoInput(req.body || {});
  if (error) return res.status(400).json({ error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO memos (user_id, body, category, importance, due_at, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [req.user.id, value.body, value.category, value.importance,
       value.due_at, value.latitude, value.longitude],
    );
    const memoId = rows[0].id;
    if (value.photos?.length) await replacePhotos(client, memoId, value.photos);
    await client.query('COMMIT');
    res.status(201).json({ id: memoId });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// --- 詳細（Check / output）。閲覧カウントは1時間デデュープで +1 -----------
memosRouter.get('/:id', async (req, res) => {
  // カウンタ更新では updated_at を動かさない
  await query(
    `UPDATE memos
        SET view_count = view_count + 1, last_viewed_at = now()
      WHERE id = $1 AND user_id = $2
        AND (last_viewed_at IS NULL
             OR last_viewed_at < now() - make_interval(mins => $3))`,
    [req.params.id, req.user.id, WEIGHT.VIEW_DEDUP_MIN],
  );

  const { rows } = await query(
    `SELECT ${LIST_COLUMNS} FROM memos m WHERE m.id = $1 AND m.user_id = $2`,
    [req.params.id, req.user.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'メモが見つかりません' });
  res.json({ memo: rows[0] });
});

// --- 写真（一覧クエリでは join しない。個別取得） --------------------------
memosRouter.get('/:id/photos', async (req, res) => {
  const owner = await query(
    `SELECT 1 FROM memos WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id],
  );
  if (!owner.rows.length) return res.status(404).json({ error: 'メモが見つかりません' });

  const { rows } = await query(
    `SELECT data, "order" FROM memo_photos WHERE memo_id = $1 ORDER BY "order"`,
    [req.params.id],
  );
  res.json({ photos: rows });
});

// --- 更新（Push 編集モード / effect） --------------------------------------
memosRouter.put('/:id', async (req, res) => {
  const { error, value } = validateMemoInput(req.body || {});
  if (error) return res.status(400).json({ error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE memos
          SET body = $1, category = $2, importance = $3, due_at = $4,
              latitude = $5, longitude = $6, updated_at = now()
        WHERE id = $7 AND user_id = $8
        RETURNING id`,
      [value.body, value.category, value.importance, value.due_at,
       value.latitude, value.longitude, req.params.id, req.user.id],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'メモが見つかりません' });
    }
    if (value.photos !== undefined) await replacePhotos(client, req.params.id, value.photos);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// --- 削除（Push 編集モード / effect） --------------------------------------
memosRouter.delete('/:id', async (req, res) => {
  const { rowCount } = await query(
    `DELETE FROM memos WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id],
  );
  if (!rowCount) return res.status(404).json({ error: 'メモが見つかりません' });
  res.json({ ok: true });
});

// --- 手動順位操作（Check 側に残す例外 / output のチューニング） ------------
// steps はクライアントで実移動可能範囲にクランプ済みの値を受け、
// サーバ側でも上限を掛ける（モック未クランプ問題の本実装修正）。
memosRouter.post('/:id/manual', async (req, res) => {
  const direction = req.body?.direction;
  const steps = Number(req.body?.steps);
  if (!['up', 'down'].includes(direction) || !Number.isInteger(steps) || steps < 1) {
    return res.status(400).json({ error: '操作内容が不正です' });
  }

  const countRes = await query(
    `SELECT count(*)::int AS n FROM memos WHERE user_id = $1`,
    [req.user.id],
  );
  const clamped = Math.min(steps, Math.max(0, countRes.rows[0].n - 1));
  if (clamped < 1) return res.json({ ok: true, applied: 0 });

  const column = direction === 'up' ? 'manual_up_count' : 'manual_down_count';
  // カウンタ更新では updated_at を動かさない
  const { rowCount } = await query(
    `UPDATE memos
        SET ${column} = ${column} + $1, last_manual_at = now()
      WHERE id = $2 AND user_id = $3`,
    [clamped, req.params.id, req.user.id],
  );
  if (!rowCount) return res.status(404).json({ error: 'メモが見つかりません' });
  res.json({ ok: true, applied: clamped });
});
