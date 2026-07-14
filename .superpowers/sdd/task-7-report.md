# Task 7 Report: Gated UTC→NZ Timestamp Migration

## Status: COMPLETE

## Commit
`1e8ba94` — "feat: gated UTC->NZ timestamp migration (dry-run preview, --apply, backup)"

## Files Changed
- `public/logic.js` — added `utcStampToTZ(tz, stamp)` inside UMD factory and included in return object
- `scripts/migrate-timestamps-nz.js` — created; exports `planTimestampMigration` and `applyTimestampMigration`; CLI with dry-run (default) and `--apply` flag
- `test/migrate-timestamps-nz.test.js` — created; 3 tests

## Test Results

### Task test: `node --test test/migrate-timestamps-nz.test.js`
```
✔ utcStampToTZ converts a timed UTC stamp to NZ
✔ utcStampToTZ leaves a midnight/date-only stamp unchanged
✔ planTimestampMigration converts timed rows, skips date-only rows
pass 3 / fail 0
```

### Full suite: `node --test`
```
pass 90 / fail 0   (87 baseline + 3 new)
```

## Safety Confirmations

- `planTimestampMigration` is READ-ONLY: queries only, no writes, no side effects.
- Midnight/date-only rows (time component `00:00:00`) are skipped — the regex `\d{4}-\d{2}-\d{2} 00:00:00` guards this in `utcStampToTZ`; confirmed by the test 'legacy date-only row must be skipped'.
- `applyTimestampMigration` wraps all writes in a transaction (BEGIN/COMMIT/ROLLBACK).
- CLI backs up the DB file with `copyFileSync` before any writes; `Date.now()` only appears in the backup filename (not in tested code).
- `utcStampToTZ` uses `nowInTZ` which uses `Intl.DateTimeFormat` — same engine as the rest of the app's TZ logic.
- UMD wrapper in `logic.js` is intact.
- No new npm dependencies.

## Concerns
None. Implementation is straightforward and the tests cover both the pure helper and the plan function.

---

## Hardening Pass (review fixes, commit after 1e8ba94)

### Changes

**public/logic.js — IMPORTANT 1: Anchored midnight regex**
- Changed `/\d{4}-\d{2}-\d{2} 00:00:00/` to `/^\d{4}-\d{2}-\d{2} 00:00:00$/` so only a fully-formed exact midnight stamp is treated as "leave unchanged" — a partial match (e.g. embedded in a longer string) can no longer slip through.
- Replaced the inline end-of-line comment with a two-line explanatory comment: "Midnight/date-only stamps are legacy sessions recorded without a time component; converting them would shift the date itself, so leave them as-is."

**scripts/migrate-timestamps-nz.js — Idempotency sentinel (needed for IMPORTANT 2)**
- Added `_ensureMigratedColumn(db)` helper: issues `ALTER TABLE workout_sessions ADD COLUMN tz_migrated INTEGER` once (idempotent via PRAGMA check).
- `planTimestampMigration` now filters `WHERE tz_migrated IS NOT 1` so already-converted rows are never queued again.
- `applyTimestampMigration` sets `tz_migrated = 1` on every row that had at least one field converted, inside the same transaction.
- Safety model unchanged: plan is still read-only (the column add is a DDL gate, not a data write), apply is still transactional, CLI keeps backup+--apply.

**test/migrate-timestamps-nz.test.js — IMPORTANT 2 + MINOR**
- MINOR: existing plan test now also asserts the `finished_at` conversion entry (`finishedConv.to === '2026-07-14 07:50:28'`).
- New test `applyTimestampMigration writes converted values; midnight row unchanged`: seeds a timed and a legacy midnight session, runs plan+apply, asserts both fields of the timed row converted in the DB, midnight row unchanged, and return value equals 2 (number of converted fields).
- New idempotency test `applyTimestampMigration is idempotent — second plan produces empty convert array`: after first plan+apply, a second `planTimestampMigration` returns `convert.length === 0`, proving no double-shift is possible.

### Test Results

#### Task test: `node --test test/migrate-timestamps-nz.test.js`
```
pass 5 / fail 0
  ✔ utcStampToTZ converts a timed UTC stamp to NZ
  ✔ utcStampToTZ leaves a midnight/date-only stamp unchanged
  ✔ planTimestampMigration converts timed rows, skips date-only rows
  ✔ applyTimestampMigration writes converted values; midnight row unchanged
  ✔ applyTimestampMigration is idempotent — second plan produces empty convert array
```

#### Full suite: `node --test`
```
pass 92 / fail 0   (87 baseline + 5 migration tests)
```

Idempotency test: PASSES — confirmed no double-shift.
