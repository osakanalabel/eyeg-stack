# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EyeG-Stack is a smartphone-oriented web app built around the concept: "jot it
down quickly, and let it surface on its own later." It replicates the ease of
Google Keep while adding a weighted ranking system that naturally surfaces
important memos — without the user having to search.

The API is self-implemented (Google Keep's API is not public), which also
enables future integration with other EyeG-series apps.

## Current Status

**v0.1.0 implemented.** The application lives in `02-app/` (see
`02-app/README.md` for full details): Express API (Node 22 / ESM, no build
step), static frontend served by nginx, PostgreSQL schema, and a 3-container
docker-compose (nginx / api / postgres) targeting the VPS.

Commands:

```sh
cd 02-app/api && npm install && npm test   # weight-algorithm unit tests
cd 02-app && docker compose up -d --build  # full stack on :8080 (needs .env)
```

The weight algorithm v1.1 (fuzzy S_cat) is a pure function in
`02-app/api/src/memos/weight.js`; its tests assert the exact verification
values documented in `00-docs/draft/03.weight-algorithm.md`. Tuning constants
live in `02-app/api/src/config.js` (`WEIGHT`).

## EyeG Series Philosophy

**Simple and straightforward above all else.**

- Keep features role-separated along the **effect / output** split (see below).
- Do not mix concerns just because it seems convenient. Guard against feature
  creep that compromises simplicity.
- The product should require no explanation — intuitive from the first use.

## Push & Check — effect / output

Features split into two groups, framed as **effect (作用) / output (出力)**, not
"input / output". `00-docs/core.md` is authoritative.

- **Push = effect** — operations that *change* a memo's state: create, **edit,
  and delete**. Anything that mutates data lives on the Push side.
- **Check = output** — *reading* and displaying memos. No destructive/mutating
  operations.

Use this as the rule when deciding where a feature belongs.

- **Edit** is NOT placed in Check; it navigates to the Push screen (edit mode,
  `push.html?id=`). Sister app eyeg-cal follows the same "navigate away to edit"
  convention.
- **Delete** is reachable from Check's detail modal (decided 2026-08-08 —
  see below), but only through an explicit `eyegConfirm()` step.
- **Exception**: Check's manual reordering (`manual_up_count` /
  `manual_down_count`) technically mutates counts, but counts as "tuning the
  output" and stays on the Check side.

### 決定: Check 詳細モーダルからの削除 (2026-08-08)

Push 画面へ遷移してから削除する導線が重い、という課題への結論。**採用**: Check
のメモをタップして開く詳細モーダルのフッタに、編集ボタンと並べてゴミ箱アイコンを
置く。押すと `eyegConfirm()` で確定し、その場で `DELETE /api/memos/:id` → モーダ
ルを閉じて一覧を再取得する。リストカードのレイアウトは変更しない。

位置づけの整理: **詳細モーダルは出力 (Check) の延長であり、そこから編集 (Push へ
遷移) と削除 (確定モーダル) が分岐する。** タップという明示的な一段を経ているため
誤爆リスクが低く、破壊操作は必ず確認を挟む、という effect/output 分離の本来の狙い
は保たれる。

実装上の必須事項:

- アイコン・確認文言・`danger: true` は `push.html` の `#delete-btn` と**完全に
  揃える** (ゴミ箱アイコン + 「削除すると元に戻せません。」)。同じ操作が画面ごとに
  違う見た目になるのを防ぐ。
- `memos` に `deleted_at` は無く API も物理 DELETE (`memo_photos` は FK CASCADE)。
  **取り消しは効かない。**

非採用: カードのスワイプ削除。理由は上記の物理削除 (Undo が無い状態で誤爆が即・
不可逆) と、カードが既に長押し→ドラッグ並べ替えにポインタジェスチャを使っており
軸判定が衝突するため。将来スワイプを入れるなら、先に論理削除 + Undo が要る。
その他の非採用案: 長押しでの複数選択一括削除 (メモ数が増えてから追加するのが自
然)、リストカード上のオーバーフローメニュー。

## Vocabulary

| Action | Term | Description |
|--------|------|-------------|
| Add a memo | **Push** | Push onto the stack |
| View memos | **Check** | Check the stack |

Push and Check must not be mixed — keep to the effect / output split above.

## Document Structure

```
00-docs/
  core.md              # Core concept — source of truth for design decisions
  draft/               # Early notes: concept, naming, data model
  cowork2code/         # 過去の指示書アーカイブ（現在は運用していない）
  code2cowork/         # 過去のフィードバックのアーカイブ（同上）
01-mock/               # HTML mockups (no API; look & UX validation only)
02-app/                # The application (api / web / nginx / db / compose)
```

開発はかきざきさんと Claude Code の対話のみで進める（2026-08-08 方針変更）。
**指示書 / フィードバックのやり取りは、明示的に指示されたときだけ書く。**
`cowork2code/` `code2cowork/` は過去分のアーカイブであり、通常の作業で新規
ファイルを追加する必要はない。

そのぶん、**対話で決めたことのうち後から効くものは `CLAUDE.md` と
`00-docs/core.md` に直接反映する**。とくに、規約を変える決定・採用しなかった案と
その理由・実装上の制約は、やり取りが流れると失われるのでドキュメント側に残すこと。

When a design decision is ambiguous, `00-docs/core.md` is authoritative.

## Data Model (PostgreSQL)

See `00-docs/draft/02.data-model.md` for the full schema. Key points:

- **users** — UUID PK; `email` UNIQUE NOT NULL (passwordless; no `login_id` /
  `password_hash` — see Authentication); `display_name`, `last_login_at`.
- **category_labels** — per-user display names for the three fixed categories.
  Categories are a fixed set of `personal` / `work` / `general`; only their
  labels are customizable. No row → use default labels (私用 / 仕事用 / 一般).
- **memos** — `body`, `category`, `importance` (SMALLINT 1–5, NULL = unset),
  `due_at` (DATE — the UI is date-only and the weight spec resolves it to
  end-of-day in the user's tz at read time), `latitude`/`longitude` (GPS),
  `view_count` (drives weighting).
- **memo_photos** — 1-to-many with memos, max 4 (`order` 0–3, UNIQUE per memo).
  Images are stored as base64 TEXT; the client resizes to ~1024px long edge
  before encoding.

Design rules:
- Memo-list queries do **not** join `memo_photos`. Fetch images via a separate
  per-memo endpoint.
- Categories are always one of the three fixed values — do not introduce new
  category types.

## Check Ranking

The default Check view orders memos by a computed **weight**, not by sort. Weight
combines: category × time-of-day (e.g. work-priority during the day, personal on
weekends), importance, due-date proximity, `view_count`, and freshness
(new / recently-updated). Additional plain sort/filter views (by date, by
category) are also offered, but weighting is the headline UX.

## Authentication

- Auth must be **loosely coupled** from other features to allow future
  replacement (OAuth, 2FA, etc.). Other modules depend on `users` only via FK;
  keep auth logic independent. Auth-owned tables use the `auth_` prefix.
- Implementation (decided 2026-06-11, supersedes the provisional ID+password
  Argon2 plan): **email-only magic link** via Resend. No password, no 2FA.
  One-time login token (15 min, single-use) → session cookie (30 days). Users
  are created on first successful link verification.

## UI / Mockups

- Share visual consistency with other EyeG-series apps. The series uses a shared
  stylesheet (`eyeg-cal/shared/eyeg.css`) and a common layout skeleton:
  `.eyeg-app` / `.eyeg-header` / `.eyeg-main` / `.eyeg-actions`. Follow that
  structure in mockups.
- **Mocks are self-contained single files.** Do not `<link>` to
  `eyeg-cal/shared/eyeg.css`; copy the needed parts into an inline `<style>` so
  each mock stands alone. Reuse eyeg-cal class names (`.eyeg-button`,
  `.menu-back`, `.eyeg-modal`, etc.) rather than inventing new ones.
- **Mock layout is flat under `01-mock/`**: `index.html` (menu) / `push.html` /
  `check.html`. They navigate via relative hrefs (menu ↔ push ↔ check). Keep
  navigation inside EyeG-Stack — there is **no** cross-app link to eyeg-cal.
- Theme colors are per-page `body` classes overriding the 5 `:root` tokens:
  `.theme-neutral` (gray — login / index), `.theme-push` (blue-leaning),
  `.theme-check` (teal/emerald-leaning). The base viridian set
  (`--eyeg-bg-light: #0B6985`, `--eyeg-accent-mid: #1F9CC4`) remains the
  default fallback.
- Header navigation is icon-only (`.menu-back--icon`): a grid icon to the menu,
  a sibling-page icon (Check shows ＋ → Push; Push shows a list icon → Check),
  and a door-arrow logout button. Check additionally has a ＋ FAB (bottom
  right) as the primary route to Push. No text links in the header.
- The weighted default Check tab is labeled **「フロート」** (internal sort key
  stays `recommended`).
- Push screen UX: input-ready on open, primary fields (memo text + category)
  large and always visible; rarely-used fields (importance, due date, photos)
  hidden behind a "+ details" expander; GPS acquired in the background (no UI
  beyond a small status line); tap targets ≥ 44px. Use a themed modal (port of
  eyeg-cal's `EyeG.confirm()`) for confirmation, not native `alert/confirm`.

## Sister App Reference

`eyeg-cal/` is the read-only sister-app reference for UI/UX alignment. **Never
write to `eyeg-cal/` under any circumstances.** Note: it may be mounted
externally and not always present in this workspace — if absent, follow the
layout conventions documented above.
