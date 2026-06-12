// カテゴリ表示名（固定3種 personal / work / general のラベルのみカスタム可）。
// レコードがないカテゴリはデフォルト表示名を返す。

import { Router } from 'express';
import { query } from '../db.js';
import { CATEGORIES, DEFAULT_LABELS } from '../config.js';

export const labelsRouter = Router();

labelsRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT category, label FROM category_labels WHERE user_id = $1`,
    [req.user.id],
  );
  const labels = { ...DEFAULT_LABELS };
  for (const r of rows) labels[r.category] = r.label;
  res.json({ labels });
});

labelsRouter.put('/', async (req, res) => {
  for (const cat of CATEGORIES) {
    const label = req.body?.[cat];
    if (label === undefined) continue;
    const v = String(label).trim();
    if (!v || v.length > 50) return res.status(400).json({ error: 'ラベルは1〜50文字です' });
    await query(
      `INSERT INTO category_labels (user_id, category, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, category) DO UPDATE SET label = $3`,
      [req.user.id, cat, v],
    );
  }
  res.json({ ok: true });
});
