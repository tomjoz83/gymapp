# Task 2.3 Report: public/local-db.js

## Status
COMPLETE — all steps done, full suite green.

## Commit
`18beeb1` — "feat: local-db.js — async on-device SQLite layer (ported SQL), tested via node:sqlite adapter"

## Test commands + results

```
node --test test/local-db.test.js   → 3/3 pass
node --test                          → 103/103 pass (was 100; +3 new)
```

## Files touched
- `public/local-db.js` (created, 340+ lines)
- `test/local-db.test.js` (created, verbatim from brief)

## Functions ported

From **read-queries.js**: `getActiveProgram`, `getProgramWeek`, `listSessions`, `getSession`, `getProgress`, `findSessionForSlot`, `listLoggedExercises`

From **store.js**: `findOrCreateExercise`, `est1RM`, `createSession`, `finishSession`, `logSet`, `recomputePRs`, `updateSetLog`, `deleteSetLog`, `findOrCreateSessionForSlot`, `setProgramStartDate`, `importProgram` (including inline `programExistsMatching` logic via async `_readStoredProgramShape`/`_incomingProgramShape` helpers)

From **program-schema.js**: `validateProgram` — inlined verbatim (no cross-require possible in UMD)

## Key porting decisions

1. **validateProgram**: Inlined entirely rather than requiring `program-schema.js`. The brief requires local-db.js to avoid any server-side requires. The logic is identical — same validators, same error messages, same SLUG_RE.

2. **importProgram / programExistsMatching**: The original `programExistsMatching` calls sync `readStoredProgramShape` with multiple db.prepare chains. Ported as two private async helper functions (`_readStoredProgramShape`, `_incomingProgramShape`) that build the same normalized shape for comparison. The idempotent behavior is preserved: if slug exists, return id without modifying anything.

3. **logSet does NOT auto-recompute PRs**: Matches web layer semantics exactly. The server route calls `recomputePRs` as a separate step after logging. `updateSetLog` and `deleteSetLog` DO call `recomputePRs` (as store.js does).

4. **createSession / finishSession NZ stamps**: Default `startedAt`/`finishedAt` to `PTLogic.nowInTZ('Pacific/Auckland', new Date())` when not supplied. PTLogic resolved via dual-require (node: `require('./logic.js')`, browser: `window.PTLogic`).

5. **findOrCreateSessionForSlot**: Inlines the slot SELECT SQL (same as store.js) rather than calling `findSessionForSlot` from read-queries, which has a different return shape (`row` vs `{id, created}`).

6. **finishSession changes detection**: The node:sqlite `run()` adapter returns `{ lastId }` not `{ changes }`. `finishSession` uses a re-read to confirm the row exists if `lastId === 0` (safe fallback, matches the original intent of returning null for missing rows).

7. **UMD / no node:sqlite**: `public/local-db.js` uses the same UMD wrapper as `logic.js`. It requires only `./db-schema.js` and `./logic.js` (both also UMD). No `node:sqlite`, no `express`, no server modules.

8. **exec.exec(SCHEMA)**: `initSchema` passes the full SCHEMA string to `exec.exec()`. The node adapter wraps `db.exec()` which handles multi-statement DDL correctly.

## Self-review checklist
- [x] `local-db.js` does NOT require `node:sqlite` or `express`
- [x] Return shapes match web layer: `getActiveProgram` → `{id,name,slug,description,start_date,weekCount}`, `getProgramWeek` → `{week_number,label,routines}`, `findOrCreateSessionForSlot` → `{id,created}`, `getSession` → `{id,started_at,finished_at,notes,sets:[...]}`, `getProgress` → `{exercise,history,pr}`, `logSet` → lastId (number), `importProgram` → programId (number)
- [x] SQL strings copied verbatim from source files
- [x] Transactions use `begin/commit/rollback` pattern wrapping try/catch exactly as store.js
- [x] Full suite: 103/103 green
- [x] No modifications to read-queries.js, store.js, db.js, server.js

## Concerns
None. The `finishSession` changes-detection workaround (re-read instead of checking `changes`) is the only non-trivial divergence from the source, and it's necessary because the abstract exec adapter exposes `lastId` not `changes`. The behavior is equivalent for all normal paths.

---

## Bug-fix Amendment (post-review)

Two critical bugs found in code review and fixed before wiring up the layer.

### Bug 1 (CRITICAL) — updateSetLog missing await (~line 383)

**Problem:** The final `return exec.get(...)` had no `await`. In an async function this returns a resolved Promise-of-row rather than the row itself, so callers received a Promise object instead of the set_log row.

**Fix:** Changed to `return await exec.get('SELECT * FROM set_logs WHERE id = ?', [id]);` in `public/local-db.js`.

### Bug 2 (CRITICAL) — finishSession null-guard used lastId instead of changes (~lines 300-303)

**Problem:** The original port used `if (info.lastId === 0)` to detect "no row matched" on an UPDATE. But `lastId` is `lastInsertRowid` — it reflects the last INSERT on the connection and is never 0 after any prior insert. So `finishSession(nonExistentId)` always fell through and wrongly returned `{id, finished_at}` instead of `null`, breaking parity with store.js which uses `if (info.changes === 0) return null`.

**Fix (two-part):**
1. `public/local-db.js` — `finishSession` now checks `if (info.changes === 0) return null`. Added a comment near the check documenting that `exec.run()` MUST return `{ lastId, changes }` (the Capacitor plugin's execute/run also exposes `changes`, making this portable).
2. `test/local-db.test.js` — The node:sqlite adapter's `run()` now returns `{ lastId: Number(info.lastInsertRowid), changes: Number(info.changes) }`.

### Regression tests added (test/local-db.test.js)

- **"finishSession — real session returns result, non-existent id returns null"**: Creates a session, logs a set (so lastInsertRowid is non-zero), calls `finishSession` on the real session and asserts result is `{id, finished_at}` with `finished_at` persisted in DB; calls `finishSession(99999)` and asserts result is `null`.
- **"updateSetLog — returns actual row object with updated fields, non-existent id returns null"**: Logs a set, calls `updateSetLog` and asserts `typeof result === 'object'`, `result.weight === 120`, `result.reps === 4`; calls `updateSetLog(99999)` and asserts `null`.

### Test results

```
node --test test/local-db.test.js   → 5/5 pass  (was 3; +2 regression tests)
node --test                          → 105/105 pass (was 103; +2 new)
```
