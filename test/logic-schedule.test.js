'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

const START = '2026-07-13'; // NZ Week-1 Monday for PPL

test('dayOfWeekOffset maps Mon..Sun to 0..6', () => {
  assert.strictEqual(L.dayOfWeekOffset('Monday'), 0);
  assert.strictEqual(L.dayOfWeekOffset('Tuesday'), 1);
  assert.strictEqual(L.dayOfWeekOffset('Friday'), 4);
  assert.strictEqual(L.dayOfWeekOffset('Nonsense'), null);
});

test('slotDate matches the confirmed PPL anchor slots', () => {
  assert.strictEqual(L.slotDate(START, 1, 'Tuesday'), '2026-07-14'); // W1 Pull
  assert.strictEqual(L.slotDate(START, 1, 'Thursday'), '2026-07-16'); // W1 Leg
  assert.strictEqual(L.slotDate(START, 2, 'Monday'), '2026-07-20');   // W2 Push
  assert.strictEqual(L.slotDate(START, 6, 'Friday'), '2026-08-21');   // W6 Upper
});

test('dateToSlot inverts slotDate within program span', () => {
  assert.deepStrictEqual(L.dateToSlot(START, 6, '2026-07-14'), { weekNumber: 1, dayOffset: 1 });
  assert.deepStrictEqual(L.dateToSlot(START, 6, '2026-07-20'), { weekNumber: 2, dayOffset: 0 });
});

test('dateToSlot returns null before start and after last week', () => {
  assert.strictEqual(L.dateToSlot(START, 6, '2026-07-12'), null); // day before start
  // program spans 6 weeks = 42 days from Jul 13 → last valid day Aug 23; Aug 24 is out
  assert.strictEqual(L.dateToSlot(START, 6, '2026-08-24'), null);
});

test('weekGrid returns Mon–Sun with routine names on scheduled days', () => {
  const routinesByDay = { Monday: 'Push Day', Tuesday: 'Pull Day', Thursday: 'Leg Day', Friday: 'Upper Day' };
  const grid = L.weekGrid(START, 6, '2026-07-15', routinesByDay); // Wed of week 1
  assert.strictEqual(grid.length, 7);
  assert.strictEqual(grid[0].date, '2026-07-13');
  assert.strictEqual(grid[0].routineName, 'Push Day');
  assert.strictEqual(grid[1].routineName, 'Pull Day');
  assert.strictEqual(grid[2].routineName, null);   // Wednesday = rest
  assert.strictEqual(grid[0].weekNumber, 1);
  assert.strictEqual(grid[6].date, '2026-07-19');   // Sunday
});
