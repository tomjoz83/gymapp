'use strict';

const SLUG_RE = /^[a-z0-9-]+$/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
function isPosInt(v) {
  return Number.isInteger(v) && v > 0;
}
function isIntOrAbsent(v) {
  return v === undefined || v === null || Number.isInteger(v);
}
function isNumOrAbsent(v) {
  return v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v));
}

function validateProgram(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['program must be an object'] };
  }
  if (!isNonEmptyString(obj.slug) || !SLUG_RE.test(obj.slug)) {
    errors.push('slug must match ^[a-z0-9-]+$');
  }
  if (!isNonEmptyString(obj.name)) errors.push('name is required');
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    errors.push('description must be a string');
  }
  if (obj.active !== undefined && typeof obj.active !== 'boolean') {
    errors.push('active must be a boolean');
  }
  if (!Array.isArray(obj.weeks) || obj.weeks.length === 0) {
    errors.push('weeks must be a non-empty array');
  } else {
    obj.weeks.forEach((w, wi) => {
      const wp = `weeks[${wi}]`;
      if (!isPosInt(w.week_number)) errors.push(`${wp}.week_number must be a positive integer`);
      if (w.label !== undefined && typeof w.label !== 'string') errors.push(`${wp}.label must be a string`);
      if (!Array.isArray(w.routines) || w.routines.length === 0) {
        errors.push(`${wp}.routines must be a non-empty array`);
      } else {
        w.routines.forEach((r, ri) => {
          const rp = `${wp}.routines[${ri}]`;
          if (!isNonEmptyString(r.name)) errors.push(`${rp}.name is required`);
          if (r.day_of_week !== undefined && typeof r.day_of_week !== 'string') errors.push(`${rp}.day_of_week must be a string`);
          if (!Array.isArray(r.exercises)) {
            errors.push(`${rp}.exercises must be an array`);
          } else {
            r.exercises.forEach((e, ei) => {
              const ep = `${rp}.exercises[${ei}]`;
              if (!isNonEmptyString(e.exercise)) errors.push(`${ep}.exercise is required`);
              if (!isIntOrAbsent(e.target_sets)) errors.push(`${ep}.target_sets must be an integer`);
              if (!isIntOrAbsent(e.target_reps)) errors.push(`${ep}.target_reps must be an integer`);
              if (!isIntOrAbsent(e.target_rpe)) errors.push(`${ep}.target_rpe must be an integer`);
              if (!isIntOrAbsent(e.rest_seconds)) errors.push(`${ep}.rest_seconds must be an integer`);
              if (!isNumOrAbsent(e.target_weight)) errors.push(`${ep}.target_weight must be a number`);
            });
          }
        });
      }
    });
  }
  return errors.length ? { valid: false, errors } : { valid: true };
}

module.exports = { validateProgram };
