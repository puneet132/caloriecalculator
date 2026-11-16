# How Fourteen works

For whoever edits the code next.

## The page

`index.html` holds everything. The `<script>` at the bottom runs top to bottom once per page load:

1. Read saved state from `localStorage` and repair it (`cleanState`).
2. Work out today's date, weekday and day number in the block.
3. Render each section (`renderHero`, `renderToday`, `renderWeight`, `renderWorkout`, `renderPlan`, `renderNotes`).
4. Wire up the buttons. Most changes call `save()` and re-render the affected section; bigger changes (new plan, restore, reset, new block) save and reload the page.

Any text that came from the user, a backup file or the AI goes through `esc()` before it is put into the page.

## Saved state

Key: `fourteen.v1` in `localStorage`.

```js
{
  start: "2026-11-16",        // first day of the block (local date)
  blockDays: 14,              // 3–90
  startWeight: 85, goal: 78,  // kg; goal may be above the start (weight gain)
  weights: [{ d: "2026-11-16", w: 85 }],          // one entry per day, sorted
  days: { "2026-11-16": { checked: ["whey1"], cigs: 0, drinks: 0 } },
  overrides: { tea: "Black coffee" },             // renamed checklist items
  removedIds: ["cucumber"],                       // hidden checklist items
  customItems: [{ id: "custom-1763…", tm: "added", lbl: "Multivitamin", k: "rule" }],
  plan: { … },                                    // see below
  sample: true                                    // still on the built-in sample plan
}
```

`cleanState()` runs on every load, on restore and when a plan is applied. It drops anything malformed and falls back to the sample plan, so a damaged value can never stop the app from opening.

## Plan format

Produced by `defaultPlan()` or by the server function, always passed through `cleanPlan()`.

```js
{
  summary: "…",
  maintenanceCalories: 2500, targetCalories: 1740, targetProteinGrams: 131,
  workoutDays: [1, 3, 5],                         // 0 = Sunday
  circuit: [{ name: "Push-ups", reps: "8–12" }],
  mealRotation: [{ lunch: "…", dinner: "…" } × 7], // index 0 = Sunday
  dailyTasks: [{ id, tm, lbl, k }],               // k: "food" | "move" | "rule"
  habits: { smoking: { enabled, targetPerDay }, drinking: { enabled, targetPerWeek } }
}
```

A task label may contain `{LUNCH}` or `{DINNER}`; these are replaced with that weekday's rotation entry. On workout days a "Bodyweight circuit" item is added automatically.

## Rules worth knowing

- **Progress** counts only ticks for items on that day's list, so removed items can't push it over 100%.
- **A day is "done"** at 80% of its list. The **streak** counts consecutive done days; today doesn't break it until the day is over.
- **Drinks** are compared with the weekly target over the last 7 days.
- **Midnight:** the page reloads when the date changes while it is open, so ticks go to the right day.
- **Direction:** if the goal is above the start weight, labels switch to "gained" and "surplus".

## Service worker (`sw.js`)

| Request | Strategy |
|---|---|
| The page | Network first, 3.5 s timeout, then the cached copy |
| Icons, manifest, Google Fonts | Cached copy first, refreshed in the background |
| `/api/*` | Never touched |

Change the `v7` in the two cache names only if the caching rules themselves change.

## Server function (`api/generate-plan.js`)

`POST /api/generate-plan` with the wizard's answers as JSON. It:

1. Checks every field against allowed ranges and lists (`parseProfile`). Free text is capped at 200 characters and stripped of line breaks.
2. Applies a per-address limit (6 per 10 minutes, per server instance).
3. Calls Gemini with a response schema. The key is sent in the `x-goog-api-key` header.
4. On "busy" or "model retired" answers (404, 429, 5xx, timeout) tries the next model in `MODELS`, then the whole list once more. Gives up before Vercel's 60-second limit.
5. Returns `{ plan }` or `{ error }` with a message written for the user. Upstream error text goes to the server log only.

If Google retires a model, edit the `MODELS` list at the top of the file.

## Testing

`npm test` covers the server function. The page has no automated tests in the repository; changes in v1.1 were checked in a real browser (ticks, editing, weight, plan building, backup and restore, offline).
