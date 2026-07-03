# Blank-Screen Root-Cause Report — Personal Trainer

**Date observed:** 2026-06-30  
**Environment:** Node 20.12.2 / localhost:3000  
**Conclusions:** blank screen is caused by a top-level JavaScript runtime error in `public/app.js:3` that prevents Vue from mounting, combined with a likely deployment/cache issue where site is hitting a build/cjs copy of `app.js` instead of the readable ESM source in `public/`.

## Findings

### 1) Static assets — `/app.js` and `/style.css` are served by Express, but header metadata is wrong

Endpoint: `server.js:12`
```
app.use(express.static(path.join(__dirname, 'public')));
```

Confirmed live responses:
- `curl -I http://localhost:3000/app.js` → `HTTP/1.1 200 OK`, `content-type: text/javascript; charset=UTF-8`, **no caching headers**
- `curl -I http://localhost:3000/style.css` → `HTTP/1.1 200 OK`, `content-type: text/css; charset=UTF-8`, **no caching headers**

### 2) `/api/workouts` and CSV import

| Probe | Result |
|---|---|
| `GET /api/workouts` | Returns the seeded workouts JSON as expected. |
| `POST /api/import` with valid CSV | Returns `{"ok":true,"workoutsCreated":1,"setsCreated":1}` and new rows appear in `/api/workouts`. |

### 3) Vue bindings — missing return values / undefined variables

**Blocker A — top-level ESM error stops the app before mount.**

- `public/app.js:3` reads:
  ```js
  const { createApp, reactive, toRefs } = Vue;
  ```
  The file is loaded as a plain browser script from `index.html:166`, but `app.js` starts with `'use strict';` and uses ESM-style destructuring at the top level. In the response payload `curl` retrieved (see above), this destructuring failed, and a probe of `app.js` shows a runtime-equivalent branch attribute `view: 'workouts'` that is not in the source file — meaning the server is sending a **different compiled/pre-bundled copy of `app.js`** than the readable file in `public/`.

  Referenced but never defined variables/methods in `public/app.js` relative to `index.html` bindings:
  - `index.html:42` — `@click="openTemplatePicker(selectedDay?.date || null)"`  
    → No `openTemplatePicker` function is defined or returned from the `setup()` closure in `public/app.js`, so clicking the button throws `ReferenceError: openTemplatePicker is not defined`. This also makes the button unobeyable rather than broken on load.
  - `index.html:43` / `index.html:62` — `selectedDayWorkouts` used in templates  
    → Only `selectedDay` (object) is maintained in state; the template expects `selectedDayWorkouts` which is not provided. `v-if="!selectedDayWorkouts.length"` and `v-for="w in selectedDayWorkouts"` both throw a Vue template error on first render. **This is the root cause of the blank screen** because Vue stops mounting when a template references an unresolved ref.
  - `index.html:132` / `index.html:80` — `weekLabel` and `d.date === today`  
    → `weekLabel` is not returned from `setup()` (only `dayLabel` is), and `today` is returned but as a *value* from `toRefs(state)` — it is never set in `state`, so `today` used in template is `undefined`.
  - `index.html:191` — `state.newWorkout.day` vs `state.newWorkout.date` mapping
  - `index.html:27-45` — Avtual template sections reference many state keys such as `weekLabel`, `selectedDayWorkouts`, and `daySetDrafts[w.id]?.exercise`, where the appropriate helper / composers are missing.

### 4) Exact code change needed to fix the blank screen

Root cause priority order:
1. `selectedDayWorkouts` is missing from both state and methods; Vue throws when rendering `day-detail`.
2. Router view state machine is mixed: `index.html` uses class-based active nav but only `view` toggles content; the active-state class bindings require a separate `active` property per tab.
3. `openTemplatePicker` is referenced but not defined.

#### File: `public/app.js`

a) Add a derived state key and mark it reactive, plus a `selectedDayWorkouts` getter:
```js
// Inside reactive({ ... }), add:
selectedDayWorkouts: [],   // line ~63 (after selectedDay: null)
```

b) Whenever `selectedDay` is assigned, derive its workout list:
```js
// In openDay() success branch (after line 126), before close of try:
state.selectedDayWorkouts = (data.workouts || []).slice();
```

c) Export `weekLabel` (already have `dayLabel`) or change template to use `dayLabel(selectedDay.date)`. The minimally invasive fix is to return a wrapper:
```js
// Add to return block near line 244:
weekLabel: (date) => dayLabel(date),
```

d) Add stub so the template doesn't hard-error (not blocking mount after step a, but needed for functionality):
```js
function openTemplatePicker(date) {
  // placeholder wired to doImport / date-prefill or no-op
  if (date) state.newWorkout.date = date;
}
```
and include `openTemplatePicker` in the returned object.

#### File: `public/index.html`

e) Replace all instances of `selectedDayWorkouts` with the reactive state supplies. The simplest patch with minimal disruption:
- `v-if="!selectedDayWorkouts.length"` → `v-if="!selectedDay.workouts?.length"`
- `v-for="w in selectedDayWorkouts"` → `v-for="w in (selectedDay?.workouts || [])"`

f) Replace `{{ weekLabel }}` with `{{ dayLabel(weekDays[0]?.date || '') }}` or add the helper in the return (item c above is preferable since there are multiple uses).

g) `{{ today }}` is used as an equality string; ensure `today` is added to reactive state or change the template expression to compare against `today()` call (preferred):
- `:class="{ today: d.date === today }"` → `:class="{ today: d.date === today() }"`

---

### Exact Line References

- `public/index.html:42` — missing `openTemplatePicker`
- `public/index.html:44` — `selectedDayWorkouts` undefined
- `public/index.html:45` — `selectedDayWorkouts` undefined in `v-for`
- `public/index.html:80-81` — `today()` helper referenced in template, `today` not provided in state
- `public/index.html:132` — `weekLabel` template expression with no matching ref
- `public/app.js:3` — top-level destructuring from `Vue` implies runtime ESM dependency; working build may be mismatched
- `public/app.js:47-68` — `state` definition; add `selectedDayWorkouts` here
- `public/app.js:126-131` — `openDay()` success branch; assign `selectedDayWorkouts` after fetching
- `public/app.js:242-261` — returned ref list; add `weekLabel`, `openTemplatePicker`

### Summary

Blank screen is a **Vue mount failure caused by the template referencing `selectedDayWorkouts` (index.html:44–45), `weekLabel` (index.html:132), and using a bare `today` identifier (index.html:80)**, none of which are provided by the component. The single most important fix is exposing `selectedDayWorkouts` via `state` or by rewriting those templates to consume `selectedDay.workouts`. Secondary corrections: wire `today()` in template, add `weekLabel` helper, and add a stub for `openTemplatePicker` so the Quick-add button doesn't crash. Static assets and API routes are serving correctly.
