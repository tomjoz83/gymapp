'use strict';

// Tiny dependency-free CSV helpers (RFC-4180-ish: handles quotes, commas,
// and newlines inside quoted fields).

function parse(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  // flush trailing field/row
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  // drop fully-empty trailing rows
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

// Parse into array of objects keyed by the header row.
function parseObjects(text) {
  const rows = parse(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
    return obj;
  });
}

function escape(value) {
  const v = value == null ? '' : String(value);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// rows: array of arrays. Returns a CSV string.
function stringify(rows) {
  return rows.map((r) => r.map(escape).join(',')).join('\n') + '\n';
}

module.exports = { parse, parseObjects, stringify };
