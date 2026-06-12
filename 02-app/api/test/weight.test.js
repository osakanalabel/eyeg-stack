// 00-docs/draft/03.weight-algorithm.md の「計算例（スクリプト検証済み）」を
// そのままテストケースにする。基準時刻 2026-06-10（水）14:00 JST 固定。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weight, sortByWeight, zonedEndOfDay, muDay, categoryScore,
  dueScore, viewScore, freshScore, manualScore,
} from '../src/memos/weight.js';

const TZ = 'Asia/Tokyo';
const NOW = new Date('2026-06-10T14:00:00+09:00'); // 平日昼
const ctx = { now: NOW, tz: TZ };

// check.html のダミーデータ6件（created_at は JST）
const memo = (m) => ({
  importance: null, due_at: null,
  manual_up_count: 0, manual_down_count: 0, last_manual_at: null,
  ...m, updated_at: m.created_at,
});

const memos = [
  memo({ id: '1', category: 'personal', view_count: 2, created_at: '2026-06-09T08:00:00+09:00' }),
  memo({ id: '2', category: 'work', importance: 4, due_at: '2026-06-13', view_count: 5, created_at: '2026-06-08T10:30:00+09:00' }),
  memo({ id: '3', category: 'general', importance: 2, view_count: 1, created_at: '2026-06-07T21:00:00+09:00' }),
  memo({ id: '4', category: 'personal', importance: 3, due_at: '2026-06-15', view_count: 0, created_at: '2026-06-06T09:00:00+09:00' }),
  memo({ id: '5', category: 'work', importance: 5, due_at: '2026-06-10', view_count: 3, created_at: '2026-06-09T11:00:00+09:00' }),
  memo({ id: '6', category: 'general', view_count: 4, created_at: '2026-06-05T19:00:00+09:00' }),
];
const byId = Object.fromEntries(memos.map((m) => [m.id, m]));

const near = (actual, expected, eps = 0.0005) =>
  assert.ok(Math.abs(actual - expected) < eps,
    `expected ${expected}, got ${actual}`);

test('zonedEndOfDay: JST の期限日の終わりを UTC instant に解決する', () => {
  assert.equal(
    zonedEndOfDay('2026-06-10', TZ).toISOString(),
    '2026-06-10T14:59:59.000Z',
  );
});

test('各要素スコア（仕様書の検証値）', () => {
  near(dueScore('2026-06-10', ctx), 0.940);  // #5 今日期限
  near(dueScore('2026-06-13', ctx), 0.512);  // #2
  near(dueScore('2026-06-15', ctx), 0.226);  // #4
  assert.equal(dueScore(null, ctx), 0);
  assert.equal(dueScore('2026-06-01', ctx), 1); // 期限切れは 1.0 を維持

  near(viewScore(3), 0.300);
  near(viewScore(5), 0.388);
  assert.equal(viewScore(0), 0);

  near(freshScore(byId['5'].created_at, byId['5'].updated_at, ctx), 0.459);
  near(freshScore(byId['6'].created_at, byId['6'].updated_at, ctx), 0.036);
});

test('weight: 6件の計算例と一致する', () => {
  const expected = { 5: 0.716, 2: 0.517, 4: 0.241, 3: 0.200, 1: 0.200, 6: 0.193 };
  for (const [id, w] of Object.entries(expected)) {
    near(weight(byId[id], ctx), w);
  }
  // #3 = 0.2004 > #1 = 0.2000 のほぼ同値も順序が決定的であること
  assert.ok(weight(byId['3'], ctx) > weight(byId['1'], ctx));
});

test('並び順: 平日昼は今日期限・重要度5の仕事メモがトップ', () => {
  const order = sortByWeight(memos, ctx).map((m) => m.id);
  assert.deepEqual(order, ['5', '2', '4', '3', '1', '6']);
});

test('S_cat ファジィ遷移: 平日18:00前後で1時間かけてクロスフェード（v1.1検証値）', () => {
  const at = (hhmm) => ({ now: new Date(`2026-06-10T${hhmm}:00+09:00`), tz: TZ });
  near(categoryScore('work', at('17:30')), 1.000);
  near(categoryScore('work', at('17:45')), 0.850);
  near(categoryScore('work', at('18:00')), 0.700);
  near(categoryScore('work', at('18:15')), 0.550);
  near(categoryScore('work', at('18:30')), 0.400);
  near(categoryScore('personal', at('17:45')), 0.475);
  near(categoryScore('personal', at('18:00')), 0.650);
  near(categoryScore('personal', at('18:15')), 0.825);
});

test('S_cat: 遷移帯の外では crisp と一致・週末は週末行', () => {
  near(muDay(14 * 60), 1);   // 14:00
  near(muDay(3 * 60), 0);    // 3:00
  // 2026-06-13 は土曜
  const weekend = { now: new Date('2026-06-13T14:00:00+09:00'), tz: TZ };
  near(categoryScore('work', weekend), 0.2);
  near(categoryScore('general', weekend), 0.7);
  near(categoryScore('personal', weekend), 1.0);
});

test('S_man: 3段上げで6位→3位に浮上し、3週間で寄与が半減する', () => {
  const lifted = { ...byId['6'], manual_up_count: 3, last_manual_at: NOW.toISOString() };
  near(manualScore(3, 0, NOW.toISOString(), ctx), 0.537, 0.001);
  near(weight(lifted, ctx), 0.273, 0.001);

  const order = sortByWeight(
    memos.map((m) => (m.id === '6' ? lifted : m)), ctx,
  ).map((m) => m.id);
  assert.equal(order.indexOf('6'), 2); // 3位

  const threeWeeks = { now: new Date(NOW.getTime() + 21 * 86_400_000), tz: TZ };
  near(manualScore(3, 0, NOW.toISOString(), threeWeeks), 0.537 / 2, 0.001);

  assert.equal(manualScore(0, 0, null, ctx), 0);
});
