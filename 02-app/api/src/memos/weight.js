// Check 重みづけアルゴリズム v1.1（00-docs/draft/03.weight-algorithm.md）
// 純関数: weight(memo, ctx) / ctx = { now: Date, tz: 'Asia/Tokyo' 等 IANA TZ }
// 同入力なら必ず同出力（テストは時刻固定で行う）。

import { WEIGHT as W } from '../config.js';

// --- タイムゾーンヘルパー -------------------------------------------------

const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

// date を tz のローカル時刻に分解する
export function localParts(date, tz) {
  const parts = {};
  for (const p of dtf(tz).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24, // 24:00 表記対策
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday, // 'Mon' ... 'Sun'
  };
}

// tz における「dateStr (YYYY-MM-DD) の 23:59:59」の UTC instant を求める
export function zonedEndOfDay(dateStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  // 仮の UTC 時刻から始め、tz でのローカル表示とのずれで補正する（2パス）
  let ts = Date.UTC(y, m - 1, d, 23, 59, 59);
  for (let i = 0; i < 2; i++) {
    const lp = localParts(new Date(ts), tz);
    const actual = Date.UTC(lp.year, lp.month - 1, lp.day, lp.hour, lp.minute, lp.second);
    const desired = Date.UTC(y, m - 1, d, 23, 59, 59);
    ts += desired - actual;
  }
  return new Date(ts);
}

// --- 各要素 ---------------------------------------------------------------

// S_due: 期限の近さ（期限切れは 1.0 を維持 = 浮上し続ける）
export function dueScore(dueAt, ctx) {
  if (!dueAt) return 0;
  const end = zonedEndOfDay(dueAt, ctx.tz);
  const d = (end.getTime() - ctx.now.getTime()) / 86_400_000;
  if (d <= 0) return 1;
  if (d <= W.DUE_HORIZON_DAYS) return 1 - d / W.DUE_HORIZON_DAYS;
  return 0;
}

// S_imp: 重要度（未設定は中立点 0.4）
export function importanceScore(importance) {
  return importance ? importance / 5 : W.IMP_UNSET;
}

// μ_昼: 平日昼の台形メンバーシップ関数（8:00 / 18:00 境界 ±30分でクロスフェード）
export function muDay(minutesOfDay) {
  const half = W.CAT_BLEND_MIN / 2;
  const riseStart = 8 * 60 - half;   // 7:30
  const riseEnd = 8 * 60 + half;     // 8:30
  const fallStart = 18 * 60 - half;  // 17:30
  const fallEnd = 18 * 60 + half;    // 18:30
  if (minutesOfDay < riseStart || minutesOfDay >= fallEnd) return 0;
  if (minutesOfDay < riseEnd) return (minutesOfDay - riseStart) / W.CAT_BLEND_MIN;
  if (minutesOfDay < fallStart) return 1;
  return (fallEnd - minutesOfDay) / W.CAT_BLEND_MIN;
}

// S_cat: カテゴリ×時間帯（0次 TSK 合成）
export function categoryScore(category, ctx) {
  const lp = localParts(ctx.now, ctx.tz);
  if (lp.weekday === 'Sat' || lp.weekday === 'Sun') {
    return W.CAT_MATRIX.weekend[category];
  }
  const mu = muDay(lp.hour * 60 + lp.minute + lp.second / 60);
  return mu * W.CAT_MATRIX.day[category] + (1 - mu) * W.CAT_MATRIX.night[category];
}

// S_fresh: 鮮度（半減期 24h）。touched = max(created_at, updated_at)
export function freshScore(createdAt, updatedAt, ctx) {
  const touched = Math.max(new Date(createdAt).getTime(), new Date(updatedAt).getTime());
  const hours = Math.max(0, (ctx.now.getTime() - touched) / 3_600_000);
  return Math.pow(0.5, hours / W.FRESH_HALF_LIFE_H);
}

// S_view: 閲覧回数（対数逓減・100回で飽和）
export function viewScore(viewCount) {
  return Math.min(1, Math.log2(1 + viewCount) / Math.log2(1 + W.VIEW_CAP));
}

// S_man: 手動順位操作（符号つき・半減期21日）
export function manualScore(upCount, downCount, lastManualAt, ctx) {
  if (!lastManualAt) return 0;
  const base = Math.tanh((upCount - downCount) / W.MAN_SCALE);
  const days = Math.max(0, (ctx.now.getTime() - new Date(lastManualAt).getTime()) / 86_400_000);
  return base * Math.pow(0.5, days / W.MAN_HALF_LIFE_D);
}

// --- 全体式 ---------------------------------------------------------------

export function weight(memo, ctx) {
  return (
    W.W_DUE * dueScore(memo.due_at, ctx) +
    W.W_IMP * importanceScore(memo.importance) +
    W.W_CAT * categoryScore(memo.category, ctx) +
    W.W_FRESH * freshScore(memo.created_at, memo.updated_at, ctx) +
    W.W_VIEW * viewScore(memo.view_count) +
    W.W_MAN * manualScore(memo.manual_up_count, memo.manual_down_count, memo.last_manual_at, ctx)
  );
}

// 並び順の確定: weight 降順 → created_at 降順 → id 昇順（完全な決定性）
export function sortByWeight(memos, ctx) {
  return memos
    .map((m) => ({ memo: m, w: weight(m, ctx) }))
    .sort((a, b) =>
      b.w - a.w ||
      new Date(b.memo.created_at) - new Date(a.memo.created_at) ||
      String(a.memo.id).localeCompare(String(b.memo.id)),
    )
    .map((x) => x.memo);
}
