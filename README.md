# 🏋️ Personal Trainer

A single-user, workout-focused web app. Create workouts, log sets (reps + weight),
mark workouts complete, see basic progress, and import/export your data as CSV.
No login required.

- **Backend:** Node.js + Express + JSON file (`data.json`)
- **Frontend:** a single-page Vue 3 app with plain CSS
- **Storage:** a local `data.json` file created on first run

## Run it

```bash
cd /home/tj/claude/personal-trainer && ./start.sh
```

Then open <http://localhost:3000>.

The script checks for Node, installs deps on first run, and starts the server.
To use a different port: `PORT=8080 ./start.sh`.

Manual alternative: `npm install && node server.js`

## Tests

```bash
npm test
```

Runs an integration suite (Node's built-in test runner) that boots the server
against a throwaway data file — your real `data.json` is never touched. It covers
CSV import grouping, `completed` parsing, set edit/delete, the weekly view, and
workout creation.

## Features

- **Week view** — calendar grid for the current week; click any day to see/edit workouts.
- **Workouts** — create, rename/edit notes, mark complete/reopen, delete. Attach exercises with sets, reps, a prescribed RPE target, and the weight you actually used.
- **Program import** — import a 6-week (or longer) plan from CSV. Each row is one daily workout; rest/skip days are supported.
- **Sets** — log exercise / sets / reps / RPE / weight per workout; edit or delete any set. RPE is the prescribed effort target (1–10); weight records what you actually lifted.
- **Progress** — a per-workout list showing each session's exercises, total set count, and total volume (`sets × reps × weight`).
- **CSV import/export** — download all data as `workouts.csv`, or upload a CSV to bulk-add workouts. A template is available on the Import/Export tab.

## CSV program format

Upload a CSV to fill a whole training block at once. Multiple rows that share the
same workout become one session, with each row contributing one exercise/set.

| Column   | Meaning                                          |
|----------|--------------------------------------------------|
| name     | workout name (e.g. `Push Day`, `Rest Day`)       |
| day      | weekday label (optional; auto-filled from date)  |
| date     | `YYYY-MM-DD` for the planned session             |
| notes    | optional note for that day                        |
| completed| `yes`/`true`/`1`/`done` = complete; anything else (incl. blank) = not complete |
| exercise | exercise name (leave blank for rest days)         |
| sets     | positive integer — how many sets of this exercise (optional; defaults to 1) |
| reps     | positive integer — reps per set                   |
| rpe      | prescribed effort target, whole number 1–10 (optional; blank = no target) |
| weight   | number (0 or more) — weight you actually used, for reference (optional) |

**Grouping:** rows are grouped into workouts by **`name` + `date` (+ `day`)**, so
the *same* workout name on *different* dates (e.g. `Push Day` in week 1 and week 2)
is kept as separate sessions rather than merged.

Use `Rest Day` / `Skip` in `name` for rest days.

See [public/workouts-template.csv](public/workouts-template.csv) for an example.

## Managing / swapping plans

On the **Import / Export** tab:

- **Replace current plan** — tick the checkbox before importing to wipe the
  existing plan and load a fresh template in one step.
- **Archive completed now** — copies every completed workout into a separate
  `archive.json` file (configurable via `ARCHIVE_PATH`).
- **Clear all workouts** — empties the active plan.

Completed workouts are **always archived first** before a clear or replace, so
changing your plan never deletes finished sessions. Download them anytime via
**Download archive CSV**.

## API

| Method | Path                           | Purpose                    |
|--------|--------------------------------|----------------------------|
| GET    | /api/workouts                  | list workouts + sets       |
| GET    | /api/workouts/:id              | get one workout            |
| POST   | /api/workouts                  | create workout             |
| PUT    | /api/workouts/:id              | update / complete workout  |
| DELETE | /api/workouts/:id              | delete workout             |
| DELETE | /api/workouts                  | clear the whole plan (archives completed first) |
| POST   | /api/workouts/:id/sets         | add a set                  |
| PUT    | /api/workouts/:id/status       | set idle / in_progress / completed (+ elapsed) |
| PUT    | /api/sets/:id                  | update a set               |
| DELETE | /api/sets/:id                  | delete a set               |
| POST   | /api/archive                   | copy completed workouts to the archive file |
| GET    | /api/archive                   | list archived workouts     |
| GET    | /api/archive.csv               | download the archive as CSV |
| GET    | /api/export.csv                | export the active plan as CSV |
| POST   | /api/import                    | import a CSV body (`?replace=1` to swap plans) |
| GET    | /api/program/weeks             | week view data             |
| GET    | /api/program/day               | single day workout details |
