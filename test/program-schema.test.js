const { test } = require('node:test');
const assert = require('node:assert');
const { validateProgram } = require('../program-schema');

const good = {
  slug: 'ppl-hypertrophy', name: '6-Week PPL', description: 'x', active: true,
  weeks: [
    { week_number: 1, label: 'Foundation', routines: [
      { name: 'Push Day', day_of_week: 'Monday', exercises: [
        { exercise: 'Bench Press', target_sets: 4, target_reps: 8, target_weight: 60, target_rpe: 7, rest_seconds: 120 },
      ] },
      { name: 'Rest', exercises: [] },
    ] },
  ],
};

test('valid program passes', () => {
  assert.deepStrictEqual(validateProgram(good), { valid: true });
});

test('bad slug fails', () => {
  const r = validateProgram({ ...good, slug: 'Not Valid Slug' });
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('slug')));
});

test('missing weeks fails', () => {
  const r = validateProgram({ slug: 'x', name: 'X' });
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('weeks')));
});

test('exercise without name fails with a path', () => {
  const bad = JSON.parse(JSON.stringify(good));
  bad.weeks[0].routines[0].exercises[0].exercise = '';
  const r = validateProgram(bad);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('weeks[0].routines[0].exercises[0]')));
});
