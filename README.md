# Fourteen

A two-week diet and workout coach that installs on your phone like an app.

You get one plan (meals, a short bodyweight circuit, daily habits), tick it off each day, log your weight, and watch the block fill in. Your data stays on your device. An optional "New plan" button asks an AI model to write a plan for your own weight, diet and goal.

| | |
|---|---|
| **Live app** | https://caloriecalculator-delta.vercel.app (deployed by Vercel from the `master` branch) |
| **Stack** | One HTML file (no framework, no build step) · one Vercel serverless function · service worker |
| **Data** | Browser `localStorage` on the device. No account, no database. |
| **AI** | Google Gemini, called only from the server function, only when you build a new plan |

## What's in the repository

```
index.html            The whole app: markup, styles and logic
sw.js                 Service worker: offline support and caching
manifest.json         Install details (name, colours, icons)
icons/                logo.svg, 192 / 512 / maskable / apple-touch PNGs
api/generate-plan.js  Server function that asks Gemini for a plan
test/                 Tests for the server function (not deployed)
vercel.json           Function time limit; stops browsers caching sw.js
2-week-plan.md        The original plan the sample data comes from
docs/                 How the app works inside, and the change history
```

## Run it on your computer

You need Node.js 20 or newer (for the tests) and Python 3 or any static file server.

```bash
git clone https://github.com/puneet132/caloriecalculator.git
```

```bash
cd caloriecalculator
```

```bash
npm start
```

Open http://localhost:5173. It must be served over `http://`, not opened as a file, or the offline support and install prompt won't work.

Everything works locally **except "New plan"**, which needs the server function. To run that too, install the Vercel CLI and use `vercel dev` with a `GEMINI_API_KEY` (see below).

Run the tests:

```bash
npm test
```

## Deploy

The repository is connected to Vercel; every push to `master` deploys. For a fresh setup:

1. On vercel.com choose **Add New → Project** and import this repository.
2. Framework preset **Other**. Leave the build command and output directory empty.
3. Under **Settings → Environment Variables** add `GEMINI_API_KEY` with a key from Google AI Studio. Without it the app still works; only "New plan" is unavailable.
4. Deploy.

New versions reach phones on the next open. You do not need to change a version number in `sw.js` after editing `index.html`.

## Install on a phone

- **Android (Chrome):** an Install bar appears at the bottom, or use the menu → *Add to Home screen*.
- **iPhone (Safari):** Share → *Add to Home Screen*. iOS has no install button; the app shows this hint instead.

Once installed it opens full screen and works with no connection.

## Using the app

- **Today** — the day's checklist. *Edit list* renames, removes or adds items. Meal items change daily and are edited in the Plan tab.
- **Weight** — log today's weight, change your goal, see the trend.
- **Workout** — the circuit and which days it falls on. Editable.
- **Plan** — today's schedule, the calorie arithmetic and the 7-day meal rotation.
- **New plan** — answers a few questions and builds a plan with AI. Applying it starts a new block and clears the current ticks and weigh-ins (it asks first).
- **Back up data / Restore backup / Reset app** — at the bottom of the page. Because data lives only on the device, back up before switching phones or clearing browser data.

## Limits you should know about

- **No sync.** Data is per device and per browser. Use backup and restore to move it.
- **No reminders.** The app cannot send notifications; that needs a push server, which this project does not have. Use your phone's reminders app.
- **AI plans are general guidance, not medical advice.**
- **Rate limiting is best effort.** The server function limits each address to 6 plans per 10 minutes, but only within one server instance. A determined person could still use up the Gemini quota.
- **Light theme only.**

## More documentation

- [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) — data format, plan format, caching, the server function
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — what changed and when
