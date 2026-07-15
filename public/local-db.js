// public/local-db.js
// Async on-device SQLite layer for iOS. Dual-loaded (UMD pattern, same as logic.js):
//  - browser: <script src="local-db.js"> sets window.LocalDb
//  - node:    require('../public/local-db.js') gets { createLocalDb }
//
// createLocalDb(exec) returns an object whose methods mirror the web layer
// (read-queries.js + store.js) but use an injected async exec adapter:
//   exec.run(sql, params) → { lastId }
//   exec.get(sql, params) → row | undefined
//   exec.all(sql, params) → rows[]
//   exec.exec(sql)
//   exec.begin() / exec.commit() / exec.rollback()
//
// MUST NOT require node:sqlite or express — only the injected exec is used.
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LocalDb = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // ---------------------------------------------------------------------------
  // Resolve dependencies (SCHEMA and PTLogic) in both Node and browser contexts
  // ---------------------------------------------------------------------------
  var _schema = (typeof module !== 'undefined' && module.exports)
    ? require('./db-schema.js')
    : (typeof window !== 'undefined' ? window.DBSchema : self.DBSchema);

  var _PTLogic = (typeof module !== 'undefined' && module.exports)
    ? require('./logic.js')
    : (typeof window !== 'undefined' ? window.PTLogic : self.PTLogic);

  // ---------------------------------------------------------------------------
  // Inline validateProgram (ported from program-schema.js; no cross-require)
  // ---------------------------------------------------------------------------
  var SLUG_RE = /^[a-z0-9-]+$/;
  function _isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
  function _isPosInt(v) { return Number.isInteger(v) && v > 0; }
  function _isIntOrAbsent(v) { return v === undefined || v === null || Number.isInteger(v); }
  function _isNumOrAbsent(v) { return v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v)); }

  function validateProgram(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object') {
      return { valid: false, errors: ['program must be an object'] };
    }
    if (!_isNonEmptyString(obj.slug) || !SLUG_RE.test(obj.slug)) {
      errors.push('slug must match ^[a-z0-9-]+$');
    }
    if (!_isNonEmptyString(obj.name)) errors.push('name is required');
    if (obj.description !== undefined && typeof obj.description !== 'string') {
      errors.push('description must be a string');
    }
    if (obj.active !== undefined && typeof obj.active !== 'boolean') {
      errors.push('active must be a boolean');
    }
    if (!Array.isArray(obj.weeks) || obj.weeks.length === 0) {
      errors.push('weeks must be a non-empty array');
    } else {
      obj.weeks.forEach(function (w, wi) {
        var wp = 'weeks[' + wi + ']';
        if (!_isPosInt(w.week_number)) errors.push(wp + '.week_number must be a positive integer');
        if (w.label !== undefined && typeof w.label !== 'string') errors.push(wp + '.label must be a string');
        if (!Array.isArray(w.routines) || w.routines.length === 0) {
          errors.push(wp + '.routines must be a non-empty array');
        } else {
          w.routines.forEach(function (r, ri) {
            var rp = wp + '.routines[' + ri + ']';
            if (!_isNonEmptyString(r.name)) errors.push(rp + '.name is required');
            if (r.day_of_week !== undefined && typeof r.day_of_week !== 'string') errors.push(rp + '.day_of_week must be a string');
            if (!Array.isArray(r.exercises)) {
              errors.push(rp + '.exercises must be an array');
            } else {
              r.exercises.forEach(function (e, ei) {
                var ep = rp + '.exercises[' + ei + ']';
                if (!_isNonEmptyString(e.exercise)) errors.push(ep + '.exercise is required');
                if (!_isIntOrAbsent(e.target_sets)) errors.push(ep + '.target_sets must be an integer');
                if (!_isIntOrAbsent(e.target_reps)) errors.push(ep + '.target_reps must be an integer');
                if (!_isIntOrAbsent(e.target_rpe)) errors.push(ep + '.target_rpe must be an integer');
                if (!_isIntOrAbsent(e.rest_seconds)) errors.push(ep + '.rest_seconds must be an integer');
                if (!_isNumOrAbsent(e.target_weight)) errors.push(ep + '.target_weight must be a number');
              });
            }
          });
        }
      });
    }
    return errors.length ? { valid: false, errors: errors } : { valid: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers for programExistsMatching (ported from store.js)
  // ---------------------------------------------------------------------------
  function normNum(v) { return (v === undefined || v === null) ? null : v; }
  function normDesc(v) { return (typeof v === 'string' && v.trim().length > 0) ? v : null; }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------
  function createLocalDb(exec) {

    // -------------------------------------------------------------------------
    // initSchema
    // -------------------------------------------------------------------------
    async function initSchema() {
      await exec.exec(_schema.SCHEMA);
    }

    // -------------------------------------------------------------------------
    // est1RM  (pure, sync — ported verbatim from store.js)
    // -------------------------------------------------------------------------
    function est1RM(weight, reps) {
      var w = Number(weight);
      var r = Number(reps);
      if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return 0;
      return w * (1 + r / 30);
    }

    // -------------------------------------------------------------------------
    // findOrCreateExercise  (ported from store.js)
    // -------------------------------------------------------------------------
    async function findOrCreateExercise(name) {
      var trimmed = String(name || '').trim();
      if (!trimmed) throw new Error('exercise name required');
      var existing = await exec.get('SELECT id FROM exercises WHERE name = ?', [trimmed]);
      if (existing) return existing.id;
      var info = await exec.run('INSERT INTO exercises (name) VALUES (?)', [trimmed]);
      return info.lastId;
    }

    // -------------------------------------------------------------------------
    // getActiveProgram  (ported from read-queries.js)
    // -------------------------------------------------------------------------
    async function getActiveProgram() {
      var p = await exec.get(
        'SELECT id, name, slug, description, start_date FROM programs WHERE active = 1'
      );
      if (!p) return null;
      var row = await exec.get(
        'SELECT COUNT(*) c FROM program_weeks WHERE program_id = ?', [p.id]
      );
      var weekCount = row.c;
      return { id: p.id, name: p.name, slug: p.slug, description: p.description, start_date: p.start_date, weekCount: weekCount };
    }

    // -------------------------------------------------------------------------
    // getProgramWeek  (ported from read-queries.js)
    // -------------------------------------------------------------------------
    async function getProgramWeek(weekNumber) {
      var prog = await exec.get('SELECT id FROM programs WHERE active = 1');
      if (!prog) return null;
      var week = await exec.get(
        'SELECT id, week_number, label FROM program_weeks WHERE program_id = ? AND week_number = ?',
        [prog.id, weekNumber]
      );
      if (!week) return null;
      var routines = await exec.all(
        'SELECT id, name, day_of_week FROM routines WHERE program_week_id = ? ORDER BY order_index',
        [week.id]
      );
      for (var i = 0; i < routines.length; i++) {
        var r = routines[i];
        r.exercises = await exec.all(
          `SELECT e.name AS exercise, rx.target_sets, rx.target_reps, rx.target_weight,
                  rx.target_rpe, rx.rest_seconds
             FROM routine_exercises rx
             JOIN exercises e ON e.id = rx.exercise_id
            WHERE rx.routine_id = ?
            ORDER BY rx.order_index`,
          [r.id]
        );
      }
      return { week_number: week.week_number, label: week.label, routines: routines };
    }

    // -------------------------------------------------------------------------
    // setProgramStartDate  (ported from store.js)
    // -------------------------------------------------------------------------
    async function setProgramStartDate(programId, date) {
      await exec.run('UPDATE programs SET start_date = ? WHERE id = ?', [date, programId]);
      return { id: programId, start_date: date };
    }

    // -------------------------------------------------------------------------
    // listSessions  (ported from read-queries.js)
    // -------------------------------------------------------------------------
    async function listSessions() {
      return exec.all(
        `SELECT ws.id, ws.started_at, ws.finished_at,
                r.name AS routine_name,
                w.program_id AS program_id,
                (SELECT COUNT(*) FROM set_logs sl WHERE sl.session_id = ws.id) AS set_count
           FROM workout_sessions ws
           LEFT JOIN routines r ON r.id = ws.routine_id
           LEFT JOIN program_weeks w ON w.id = r.program_week_id
          ORDER BY ws.started_at DESC, ws.id DESC`
      );
    }

    // -------------------------------------------------------------------------
    // getSession  (ported from read-queries.js)
    // -------------------------------------------------------------------------
    async function getSession(id) {
      var s = await exec.get(
        'SELECT id, started_at, finished_at, notes FROM workout_sessions WHERE id = ?', [id]
      );
      if (!s) return null;
      s.sets = await exec.all(
        `SELECT sl.id, e.name AS exercise, sl.set_number, sl.weight, sl.reps, sl.rpe,
                sl.is_warmup, sl.is_complete
           FROM set_logs sl JOIN exercises e ON e.id = sl.exercise_id
          WHERE sl.session_id = ?
          ORDER BY sl.set_number, sl.id`,
        [id]
      );
      return s;
    }

    // -------------------------------------------------------------------------
    // findSessionForSlot  (ported from read-queries.js; also used internally)
    // -------------------------------------------------------------------------
    async function findSessionForSlot({ routineId, date }) {
      var row = await exec.get(
        `SELECT id, started_at, finished_at FROM workout_sessions
          WHERE routine_id = ? AND substr(started_at, 1, 10) = ?
          ORDER BY id DESC LIMIT 1`,
        [routineId, date]
      );
      return row || null;
    }

    // -------------------------------------------------------------------------
    // listLoggedExercises  (ported from read-queries.js)
    // -------------------------------------------------------------------------
    async function listLoggedExercises() {
      return exec.all(
        `SELECT e.name AS name,
                COUNT(DISTINCT sl.session_id) AS session_count,
                MAX(substr(ws.started_at,1,10)) AS last_date
           FROM set_logs sl
           JOIN exercises e ON e.id = sl.exercise_id
           JOIN workout_sessions ws ON ws.id = sl.session_id
          WHERE sl.is_warmup = 0 AND sl.weight IS NOT NULL
          GROUP BY e.id
          ORDER BY last_date DESC, e.name ASC`
      );
    }

    // -------------------------------------------------------------------------
    // getProgress  (ported from read-queries.js; uses local est1RM)
    // -------------------------------------------------------------------------
    async function getProgress(exerciseName) {
      var ex = await exec.get('SELECT id FROM exercises WHERE name = ?', [exerciseName]);
      if (!ex) return { exercise: exerciseName, history: [], pr: null };
      var rows = await exec.all(
        `SELECT ws.id AS session_id, ws.started_at AS date, sl.weight, sl.reps
           FROM set_logs sl JOIN workout_sessions ws ON ws.id = sl.session_id
          WHERE sl.exercise_id = ? AND sl.is_warmup = 0 AND sl.is_complete = 1
            AND sl.weight IS NOT NULL AND sl.reps IS NOT NULL
          ORDER BY ws.started_at ASC, ws.id ASC`,
        [ex.id]
      );

      var bySession = new Map();
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var h = bySession.get(row.session_id);
        if (!h) { h = { date: row.date, top_weight: 0, est_1rm: 0, volume: 0 }; bySession.set(row.session_id, h); }
        h.top_weight = Math.max(h.top_weight, row.weight);
        h.est_1rm = Math.max(h.est_1rm, est1RM(row.weight, row.reps));
        h.volume += row.weight * row.reps;
      }
      var pr = await exec.get(
        'SELECT rep_count, best_weight, best_est_1rm FROM personal_records WHERE exercise_id = ? ORDER BY best_est_1rm DESC LIMIT 1',
        [ex.id]
      );
      return { exercise: exerciseName, history: Array.from(bySession.values()), pr: pr || null };
    }

    // -------------------------------------------------------------------------
    // createSession  (ported from store.js; NZ default stamp via PTLogic)
    // -------------------------------------------------------------------------
    async function createSession({ routineId = null, startedAt = null, finishedAt = null, notes = null } = {}) {
      var stamp = startedAt || _PTLogic.nowInTZ('Pacific/Auckland', new Date());
      var info = await exec.run(
        'INSERT INTO workout_sessions (routine_id, started_at, finished_at, notes) VALUES (?, ?, ?, ?)',
        [routineId, stamp, finishedAt, notes]
      );
      return info.lastId;
    }

    // -------------------------------------------------------------------------
    // finishSession  (ported from store.js; NZ default stamp via PTLogic)
    // -------------------------------------------------------------------------
    async function finishSession(id, finishedAt) {
      var stamp = finishedAt || _PTLogic.nowInTZ('Pacific/Auckland', new Date());
      var info = await exec.run(
        'UPDATE workout_sessions SET finished_at = ? WHERE id = ?', [stamp, id]
      );
      if (info.lastId === 0) {
        // changes check: re-read to confirm the row existed
        var check = await exec.get('SELECT id FROM workout_sessions WHERE id = ?', [id]);
        if (!check) return null;
      }
      return { id: id, finished_at: stamp };
    }

    // -------------------------------------------------------------------------
    // logSet  (ported from store.js; does NOT auto-recompute PRs — same as
    //          web layer; the server route calls recomputePRs separately)
    // -------------------------------------------------------------------------
    async function logSet({ sessionId, exerciseName, setNumber, weight = null, reps = null, rpe = null, isWarmup = false, isComplete = true, note = null }) {
      var exerciseId = await findOrCreateExercise(exerciseName);
      var info = await exec.run(
        `INSERT INTO set_logs
           (session_id, exercise_id, set_number, weight, reps, rpe, is_warmup, is_complete, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, exerciseId, setNumber, weight, reps, rpe,
         isWarmup ? 1 : 0, isComplete ? 1 : 0, note]
      );
      return info.lastId;
    }

    // -------------------------------------------------------------------------
    // recomputePRs  (ported from store.js)
    // -------------------------------------------------------------------------
    async function recomputePRs(exerciseId) {
      var rows = await exec.all(
        `SELECT sl.reps AS reps, sl.weight AS weight, ws.started_at AS at
           FROM set_logs sl
           JOIN workout_sessions ws ON ws.id = sl.session_id
          WHERE sl.exercise_id = ? AND sl.is_warmup = 0 AND sl.is_complete = 1
            AND sl.weight IS NOT NULL AND sl.reps IS NOT NULL AND sl.reps > 0`,
        [exerciseId]
      );

      var best = new Map(); // rep_count → { weight, est, at }
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var e = est1RM(r.weight, r.reps);
        var cur = best.get(r.reps);
        if (!cur || e > cur.est) {
          best.set(r.reps, { weight: r.weight, est: e, at: r.at });
        }
      }

      await exec.begin();
      try {
        await exec.run('DELETE FROM personal_records WHERE exercise_id = ?', [exerciseId]);
        for (var entry of best) {
          var repCount = entry[0];
          var v = entry[1];
          await exec.run(
            `INSERT INTO personal_records (exercise_id, rep_count, best_weight, best_est_1rm, achieved_at)
             VALUES (?, ?, ?, ?, ?)`,
            [exerciseId, repCount, v.weight, v.est, v.at]
          );
        }
        await exec.commit();
      } catch (err) {
        await exec.rollback();
        throw err;
      }
    }

    // -------------------------------------------------------------------------
    // updateSetLog  (ported from store.js)
    // -------------------------------------------------------------------------
    async function updateSetLog(id, fields) {
      fields = fields || {};
      var existing = await exec.get('SELECT * FROM set_logs WHERE id = ?', [id]);
      if (!existing) return null;
      var weight = fields.weight != null ? fields.weight : existing.weight;
      var reps = fields.reps != null ? fields.reps : existing.reps;
      var rpe = fields.rpe !== undefined ? fields.rpe : existing.rpe;
      var isWarmup = fields.isWarmup != null ? (fields.isWarmup ? 1 : 0) : existing.is_warmup;
      var isComplete = fields.isComplete != null ? (fields.isComplete ? 1 : 0) : existing.is_complete;
      await exec.run(
        'UPDATE set_logs SET weight = ?, reps = ?, rpe = ?, is_warmup = ?, is_complete = ? WHERE id = ?',
        [weight, reps, rpe, isWarmup, isComplete, id]
      );
      await recomputePRs(existing.exercise_id);
      return exec.get('SELECT * FROM set_logs WHERE id = ?', [id]);
    }

    // -------------------------------------------------------------------------
    // deleteSetLog  (ported from store.js)
    // -------------------------------------------------------------------------
    async function deleteSetLog(id) {
      var existing = await exec.get('SELECT exercise_id FROM set_logs WHERE id = ?', [id]);
      if (!existing) return false;
      await exec.run('DELETE FROM set_logs WHERE id = ?', [id]);
      await recomputePRs(existing.exercise_id);
      return true;
    }

    // -------------------------------------------------------------------------
    // findOrCreateSessionForSlot  (ported from store.js; inlines the slot SELECT)
    // -------------------------------------------------------------------------
    async function findOrCreateSessionForSlot({ routineId, date, startedAt = null }) {
      // Inline the slot-lookup query (do NOT cross-require findSessionForSlot above
      // as it has a different signature; mirror store.js pattern exactly).
      var existing = await exec.get(
        `SELECT id FROM workout_sessions
          WHERE routine_id = ? AND substr(started_at, 1, 10) = ?
          ORDER BY id DESC LIMIT 1`,
        [routineId, date]
      );
      if (existing) return { id: existing.id, created: false };
      var stamp = startedAt || (date + ' 12:00:00');
      var id = await createSession({ routineId: routineId, startedAt: stamp });
      return { id: id, created: true };
    }

    // -------------------------------------------------------------------------
    // importProgram  (ported from store.js; uses inlined validateProgram and
    //                 programExistsMatching logic)
    // -------------------------------------------------------------------------
    async function _readStoredProgramShape(slug) {
      var p = await exec.get(
        'SELECT id, name, description, active FROM programs WHERE slug = ?', [slug]
      );
      if (!p) return null;
      var weeks = await exec.all(
        'SELECT id, week_number, label FROM program_weeks WHERE program_id = ? ORDER BY week_number',
        [p.id]
      );
      var shapeWeeks = [];
      for (var i = 0; i < weeks.length; i++) {
        var w = weeks[i];
        var routines = await exec.all(
          'SELECT id, name, day_of_week FROM routines WHERE program_week_id = ? ORDER BY order_index',
          [w.id]
        );
        var shapeRoutines = [];
        for (var j = 0; j < routines.length; j++) {
          var r = routines[j];
          var exs = await exec.all(
            `SELECT e.name AS exercise, rx.target_sets, rx.target_reps, rx.target_weight,
                    rx.target_rpe, rx.rest_seconds
               FROM routine_exercises rx JOIN exercises e ON e.id = rx.exercise_id
              WHERE rx.routine_id = ? ORDER BY rx.order_index`,
            [r.id]
          );
          shapeRoutines.push({
            name: r.name,
            day_of_week: normNum(r.day_of_week),
            exercises: exs.map(function (e) {
              return {
                exercise: e.exercise,
                target_sets: normNum(e.target_sets),
                target_reps: normNum(e.target_reps),
                target_weight: normNum(e.target_weight),
                target_rpe: normNum(e.target_rpe),
                rest_seconds: normNum(e.rest_seconds),
              };
            }),
          });
        }
        shapeWeeks.push({
          week_number: w.week_number,
          label: normNum(w.label),
          routines: shapeRoutines,
        });
      }
      return {
        id: p.id,
        shape: {
          name: p.name,
          description: normDesc(p.description),
          active: !!p.active,
          weeks: shapeWeeks,
        },
      };
    }

    function _incomingProgramShape(program) {
      var weeks = program.weeks.slice().sort(function (a, b) { return a.week_number - b.week_number; });
      return {
        name: program.name,
        description: normDesc(program.description),
        active: !!program.active,
        weeks: weeks.map(function (w) {
          return {
            week_number: w.week_number,
            label: normNum(w.label),
            routines: w.routines.map(function (r) {
              return {
                name: r.name,
                day_of_week: normNum(r.day_of_week),
                exercises: r.exercises.map(function (e) {
                  return {
                    exercise: e.exercise,
                    target_sets: normNum(e.target_sets),
                    target_reps: normNum(e.target_reps),
                    target_weight: normNum(e.target_weight),
                    target_rpe: normNum(e.target_rpe),
                    rest_seconds: normNum(e.rest_seconds),
                  };
                }),
              };
            }),
          };
        }),
      };
    }

    async function importProgram(program, createdAt) {
      var result = validateProgram(program);
      if (!result.valid) {
        throw new Error('invalid program: ' + result.errors.join('; '));
      }

      // Idempotent re-import: if this slug already exists, return its id.
      var stored = await _readStoredProgramShape(program.slug);
      if (stored !== null) {
        // Unchanged → true no-op. Changed → we still do not destructively rebuild.
        return stored.id;
      }

      var stamp = createdAt || '1970-01-01 00:00:00';
      var isActive = program.active ? 1 : 0;

      await exec.begin();
      try {
        var progInfo = await exec.run(
          'INSERT INTO programs (name, slug, description, active, created_at) VALUES (?, ?, ?, ?, ?)',
          [program.name, program.slug, program.description || null, isActive, stamp]
        );
        var programId = progInfo.lastId;

        if (isActive) {
          await exec.run('UPDATE programs SET active = 0 WHERE id != ?', [programId]);
        }

        for (var wi = 0; wi < program.weeks.length; wi++) {
          var w = program.weeks[wi];
          var weekInfo = await exec.run(
            'INSERT INTO program_weeks (program_id, week_number, label) VALUES (?, ?, ?)',
            [programId, w.week_number, w.label || null]
          );
          var weekId = weekInfo.lastId;

          for (var ri = 0; ri < w.routines.length; ri++) {
            var r = w.routines[ri];
            var routineInfo = await exec.run(
              'INSERT INTO routines (program_week_id, name, day_of_week, order_index) VALUES (?, ?, ?, ?)',
              [weekId, r.name, r.day_of_week || null, ri]
            );
            var routineId = routineInfo.lastId;

            for (var ei = 0; ei < r.exercises.length; ei++) {
              var e = r.exercises[ei];
              var exerciseId = await findOrCreateExercise(e.exercise);
              await exec.run(
                `INSERT INTO routine_exercises
                   (routine_id, exercise_id, order_index, target_sets, target_reps, target_weight, target_rpe, rest_seconds)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  routineId, exerciseId, ei,
                  e.target_sets != null ? e.target_sets : null,
                  e.target_reps != null ? e.target_reps : null,
                  e.target_weight != null ? e.target_weight : null,
                  e.target_rpe != null ? e.target_rpe : null,
                  e.rest_seconds != null ? e.rest_seconds : null,
                ]
              );
            }
          }
        }

        await exec.commit();
        return programId;
      } catch (err) {
        await exec.rollback();
        throw err;
      }
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    return {
      initSchema,
      est1RM,
      getActiveProgram,
      getProgramWeek,
      setProgramStartDate,
      listSessions,
      getSession,
      findSessionForSlot,
      findOrCreateSessionForSlot,
      listLoggedExercises,
      getProgress,
      createSession,
      finishSession,
      logSet,
      recomputePRs,
      updateSetLog,
      deleteSetLog,
      findOrCreateExercise,
      importProgram,
    };
  }

  return { createLocalDb: createLocalDb };
});
