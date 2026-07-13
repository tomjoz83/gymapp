---
name: author-program
description: Use when the user wants to author or edit a gymapp workout program from a natural-language description (e.g. "make me a 6-week push/pull/legs block ramping RPE 7 to 9"). Produces a validated program JSON file under programs/ that the deploy importer loads into the app's database.
---

# Authoring a gymapp Program

Turn a natural-language training description into a `programs/<slug>.json` file matching the schema the importer expects.

## Steps

1. **Clarify only what's missing.** You need: how many weeks, the training split (which days / routines), the exercises per routine, and how load/reps/RPE progress across weeks. If the user's description already implies these, don't re-ask — infer sensible values and state your assumptions.

2. **Choose a slug** — lowercase, digits, hyphens only (`^[a-z0-9-]+$`), derived from the program name (e.g. "6-Week PPL Hypertrophy" → `ppl-hypertrophy`). The slug is the stable key: re-authoring with the same slug REPLACES that program on next deploy.

3. **Write the JSON** to `programs/<slug>.json` with this shape:

    ```json
    {
      "slug": "ppl-hypertrophy",
      "name": "6-Week PPL Hypertrophy",
      "description": "Push/Pull/Legs, RPE 7 ramping to 9",
      "active": true,
      "weeks": [
        {
          "week_number": 1,
          "label": "Foundation",
          "routines": [
            {
              "name": "Push Day",
              "day_of_week": "Monday",
              "exercises": [
                { "exercise": "Bench Press", "target_sets": 4, "target_reps": 8, "target_weight": 60, "target_rpe": 7, "rest_seconds": 120 }
              ]
            }
          ]
        }
      ]
    }
    ```

    Field rules (validated by `program-schema.js` — the import fails the deploy if violated):
    - `slug`: required, `^[a-z0-9-]+$`.
    - `name`: required, non-empty.
    - `description`: optional string. `active`: optional boolean — set `true` on the one program that should drive the Home screen; importing an active program clears `active` on all others.
    - `weeks`: non-empty array. Each `week_number` a positive integer; `label` optional. Bake progression INTO each week (week 1 lighter/higher-rep, later weeks heavier/lower-rep or higher RPE) — the app reads the current week's targets.
    - Each routine: `name` required; `day_of_week` optional; `exercises` array (empty array = a rest day).
    - Each exercise: `exercise` name required; `target_sets`/`target_reps`/`target_rpe`/`rest_seconds` optional integers; `target_weight` optional number. Use consistent exercise names across weeks (the importer dedups by exact name).

4. **Validate before finishing.** Run:

    ```bash
    node -e "const {validateProgram}=require('./program-schema'); const p=require('./programs/<slug>.json'); const r=validateProgram(p); if(!r.valid){console.error(r.errors.join('\n')); process.exit(1)} console.log('valid')"
    ```

    Fix any reported errors and re-validate until it prints `valid`.

5. **Tell the user the next step:** commit and push `programs/<slug>.json`; the deploy importer loads it into the database automatically. To preview locally: `node scripts/import-programs.js ./programs` against a scratch `DB_PATH`.

## Notes
- To EDIT an existing program, author with the SAME slug — the importer replaces it (delete + reinsert) on next deploy.
- Duplicate a week and tweak its targets rather than re-typing when building multi-week ramps.
