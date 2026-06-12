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

- Edit/delete are NOT placed in Check; they navigate to the Push screen (edit
  mode, `push.html?id=`). Sister app eyeg-cal follows the same "navigate away to
  delete" convention.
- **Exception**: Check's manual reordering (`manual_up_count` /
  `manual_down_count`) technically mutates counts, but counts as "tuning the
  output" and stays on the Check side.

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
  cowork2code/         # Instructions from Cowork to Code (implementation specs)
  code2cowork/         # Feedback from Code to Cowork
01-mock/               # HTML mockups (no API; look & UX validation only)
02-app/                # The application (api / web / nginx / db / compose)
```

Implementation instructions arrive in `00-docs/cowork2code/` (filenames are
date-prefixed, e.g. `20260609-01_push-screen-mock.md`). Read the relevant spec
before building. Write feedback to `00-docs/code2cowork/` using the **same
filename** as the spec it responds to; follow eyeg-cal's feedback format
(指示通り / 指示外の追加判断 / 申し送り sections).

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
- Theme color is unique to EyeG-Stack and still TBD. Provisional value is a
  blue-green (viridian) set, chosen to sit between 2Cal (blue) and 4Cal (teal)
  without colliding — `--eyeg-bg-light: #0B6985`, `--eyeg-accent-mid: #1F9CC4`.
  Override the 5 `:root` tokens once the real color lands.
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
