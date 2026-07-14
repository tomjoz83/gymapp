// public/logic.js
// Pure, framework-agnostic workout logic. Dual-loaded:
//  - browser: <script src="logic.js"> sets window.PTLogic
//  - node:    require('../public/logic.js') gets module.exports
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PTLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function rpeToRir(rpe) {
    if (rpe == null) return null;
    const rir = 10 - Number(rpe);
    return Math.min(5, Math.max(0, rir));
  }
  function rirToRpe(rir) {
    if (rir == null) return null;
    const rpe = 10 - Number(rir);
    return Math.min(10, Math.max(1, rpe));
  }
  function resolvePrevious(priorSets, setNumber) {
    if (!Array.isArray(priorSets)) return null;
    const m = priorSets.find((s) => s.set_number === setNumber);
    return m ? { weight: m.weight, reps: m.reps, rpe: m.rpe } : null;
  }
  function prefillForSet(priorSets, setNumber, target) {
    const prev = resolvePrevious(priorSets, setNumber);
    if (prev) return { weight: prev.weight, reps: prev.reps };
    const t = target || {};
    if (t.target_weight != null || t.target_reps != null) {
      return { weight: t.target_weight != null ? t.target_weight : null, reps: t.target_reps != null ? t.target_reps : null };
    }
    return { weight: null, reps: null };
  }
  function formatPrevious(prev, scale) {
    if (!prev) return '—';
    const base = `${prev.weight}×${prev.reps}`;
    if (prev.rpe == null) return base;
    if (scale === 'rir') return `${base} (${rpeToRir(prev.rpe)} RIR)`;
    return `${base} @${prev.rpe}`;
  }
  function nextRestState(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    return { remaining: s, running: s > 0 };
  }
  function tickRest(state) {
    // state: { remaining, running }. Returns a NEW state after one second.
    if (!state.running) return state;
    const remaining = state.remaining - 1;
    if (remaining <= 0) return { remaining: 0, running: false, justFinished: true };
    return { remaining, running: true };
  }
  function _partsInTZ(tz, instant) {
    const d = instant instanceof Date ? instant : new Date(instant);
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const p = {};
    for (const { type, value } of f.formatToParts(d)) p[type] = value;
    // en-CA gives 24h; guard the "24" hour edge some engines emit at midnight.
    if (p.hour === '24') p.hour = '00';
    return p;
  }
  function todayInTZ(tz, instant) {
    const p = _partsInTZ(tz, instant);
    return `${p.year}-${p.month}-${p.day}`;
  }
  function nowInTZ(tz, instant) {
    const p = _partsInTZ(tz, instant);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  }
  function utcStampToTZ(tz, stamp) {
    // stamp: "YYYY-MM-DD HH:mm:ss" interpreted as UTC → NZ wall-clock string.
    // Midnight/date-only stamps are legacy sessions recorded without a time component;
    // converting them would shift the date itself, so leave them as-is.
    if (!stamp || /^\d{4}-\d{2}-\d{2} 00:00:00$/.test(stamp)) return stamp;
    const iso = stamp.replace(' ', 'T') + 'Z';
    return nowInTZ(tz, new Date(iso));
  }
  var _DOW = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };
  function dayOfWeekOffset(name) {
    return Object.prototype.hasOwnProperty.call(_DOW, name) ? _DOW[name] : null;
  }
  function _mkUTC(ymd) { return new Date(ymd + 'T00:00:00Z'); }
  function _fmtUTC(d) { return d.toISOString().slice(0, 10); }
  function _addDays(ymd, n) { const d = _mkUTC(ymd); d.setUTCDate(d.getUTCDate() + n); return _fmtUTC(d); }
  function _diffDays(a, b) { return Math.round((_mkUTC(a) - _mkUTC(b)) / 86400000); }

  function slotDate(startDate, weekNumber, dayName) {
    const off = dayOfWeekOffset(dayName);
    if (off == null) return null;
    return _addDays(startDate, 7 * (weekNumber - 1) + off);
  }
  function dateToSlot(startDate, weekCount, date) {
    const delta = _diffDays(date, startDate);
    if (delta < 0 || delta >= 7 * weekCount) return null;
    return { weekNumber: Math.floor(delta / 7) + 1, dayOffset: delta % 7 };
  }
  function weekGrid(startDate, weekCount, anchorDate, routinesByDay) {
    // Monday of the week containing anchorDate.
    const delta = _diffDays(anchorDate, startDate);
    const weekIdx = Math.floor(delta / 7); // may be negative or >= weekCount (out-of-program weeks)
    const monday = _addDays(startDate, weekIdx * 7);
    const names = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const date = _addDays(monday, i);
      const slot = dateToSlot(startDate, weekCount, date);
      const routineName = slot ? (routinesByDay[names[i]] || null) : null;
      cells.push({
        date,
        inProgram: !!slot,
        weekNumber: slot ? slot.weekNumber : null,
        routineName,
      });
    }
    return cells;
  }
  return { rpeToRir, rirToRpe, resolvePrevious, prefillForSet, formatPrevious, nextRestState, tickRest, todayInTZ, nowInTZ, utcStampToTZ, dayOfWeekOffset, slotDate, dateToSlot, weekGrid };
});
