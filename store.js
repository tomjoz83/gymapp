'use strict';

function findOrCreateExercise(db, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('exercise name required');
  const existing = db.prepare('SELECT id FROM exercises WHERE name = ?').get(trimmed);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO exercises (name) VALUES (?)').run(trimmed);
  return Number(info.lastInsertRowid);
}

module.exports = { findOrCreateExercise };
