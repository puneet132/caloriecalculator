# START HERE — Fourteen

Everything for this project in one place. Open this first tomorrow.

Fourteen is a **daily diet + workout coach**, built as an installable PWA. It encodes the 14-day fat-loss plan we worked out (85 kg → 78 kg goal, this block targets the first 2–2.5 kg), lets you tick off each day, tracks weight and a cigarette count, shows a streak, and works offline once installed. Data stays on your device (`localStorage`) — no account, no backend.

---

## 1. What's in the folder

```
coach-pwa/
  index.html      the whole app — 3D-scroll landing + the tracker + all logic
  manifest.json   install metadata (name, icons, colours)
  sw.js           service worker — offline caching
  vercel.json     stops the browser over-caching sw.js / manifest
  icons/          192, 512, maskable — generated from the 14-bar motif
  README.md       original deploy notes
START-HERE.md     this file
2-week-plan.md    the diet + workout plan in plain text
daily-coach.jsx   React version of the tracker (only if you ever want a React app)
```

For deploying and running locally you only need the **`coach-pwa/`** folder. Ignore `daily-coach.jsx` unless you move to a React setup later.

---

## 2. Run it locally (localhost)

The app is plain HTML/CSS/JS — no build step. But it **must be served over http**, not opened as a `file://` path, or the service worker and install prompt won't work. Two easy ways:

**Option A — Python (already on most laptops)**
```bash
cd coach-pwa
python3 -m http.server 5173
# open http://localhost:5173
```

**Option B — VS Code Live Server**
1. Open the `coach-pwa` folder in VS Code
2. Install the "Live Server" extension
3. Right-click `index.html` → "Open with Live Server"

**Option C — Node, if you prefer**
```bash
cd coach-pwa
npx serve .
```

Edit any file, save, refresh the browser. If a change to `sw.js` doesn't show up, open DevTools → Application → Service Workers → "Unregister", then reload (the service worker caches aggressively — see §5).

---

## 3. Deploy to Vercel

**Drag-and-drop (simplest):**
1. vercel.com → **Add New → Project**
2. Drag the `coach-pwa` folder onto the drop zone
3. Framework preset: **Other**. Leave build command + output directory blank.
4. Deploy → you get a `*.vercel.app` URL in ~20 seconds.

**CLI:**
```bash
npm i -g vercel
cd coach-pwa
vercel          # preview URL
vercel --prod   # production
```

**GitHub (best once you're iterating):**
```bash
cd coach-pwa
git init && git add . && git commit -m "fourteen"
gh repo create fourteen --public --source=. --push
```
Import the repo on Vercel once; every `git push` then redeploys automatically. This is the setup I'd recommend since you want to keep changing the UI.

**Install on phone:** open the URL → Android shows an Install banner; iPhone → Share → Add to Home Screen.

---

## 4. Where to change things

All the plan data sits at the **top of the `<script>` block in `index.html`** — you don't need to hunt through the code:

| Want to change | Edit this | Notes |
|---|---|---|
| Lunch sabji rotation | `SABJI` array | Indexed Sunday-first: `[Sun, Mon, Tue, Wed, Thu, Fri, Sat]` |
| Dinner rotation | `DINNER` array | Same Sunday-first order |
| Which days are workout days | `WO` | `[1,3,5]` = Mon/Wed/Fri (0 = Sun) |
| Exercises + reps | `CIRCUIT` | `["name","reps"]` pairs |
| The daily checklist items | `tasksFor()` | Add/remove `{id, tm, lbl}` objects |
| Start weight / goal | `S.startWeight`, `S.goal` | 85 and 78 |
| Cigarette target | search `<=5` / `-5` in `renderToday()` | Currently 5/day |

**UI / look:** all styling is in the single `<style>` block in `index.html`. The colour palette is CSS variables at the very top under `:root` — change `--ink`, `--sage`, `--haldi`, `--go`, `--clay` and the whole theme shifts. Fonts are Bricolage Grotesque (numbers) + Inter (body).

**The 3D scroll landing:** lives in the `#stage` / `#plates` markup and the `frame()` function. The stack rotation, the plates spreading in depth, and the 85→78 counter are all driven off scroll position there.

---

## 5. The one gotcha: the service worker cache

After you change `index.html` and redeploy, phones that already loaded the app may keep showing the **old** version because `sw.js` cached it. Fix: bump the cache name in `sw.js`:

```js
const CACHE = "fourteen-v1";   // change to "fourteen-v2", "v3", ... on each release
```

That forces the old cache to clear on next open. Do this every time you ship a real change.

---

## 6. What it does NOT do (and the plan for it)

It **can't send push notifications.** Web push needs a small backend and a push subscription, and on iPhone it only works for an installed PWA on iOS 16.4+. That's why your daily nudges live in the **phone Reminders app** (already set up — see §7). The PWA is where you *tick things off*; the reminders are what *reach you*.

If you later want real push, it's a small serverless function on Vercel plus a VAPID key pair — a clean next step once the app itself is settled.

---

## 7. Reminders already set (in your phone's Reminders app)

These fire on their own, daily, independent of the app:

| Time | Reminder |
|---|---|
| 9:30 AM | Morning walk — 30 min |
| 10:30 AM | Whey — scoop 1 |
| 2:30 PM | Lunch — 3 roti + sabji + 150g paneer + salad |
| 7:30 PM | Whey — scoop 2 |
| 9:00 PM | Dinner — dal + 100g raw paneer (rotation in the note) |
| 9:45 PM | Post-dinner walk — 20 min |
| 7:00 PM Mon/Wed/Fri | Bodyweight circuit |
| 10:00 AM Sunday | Weekly weigh-in + waist |

Adjust times freely — you wake at 10, so the 9:30 walk may want moving.

---

## 8. The plan it encodes (quick reference)

**Daily intake ~1,740 kcal · ~131g protein · maintenance ~2,500 · deficit ~760/day → ~0.65 kg/week**

| Time | Item |
|---|---|
| 10:30 | Whey, 1 scoop in water |
| 12:00 | Green tea |
| 14:30 | 3 roti + day's sabji + 150g raw paneer + salad |
| 19:30 | Whey, 1 scoop in water |
| 21:00 | Dal 2 bowls (or dal + rice) + 100g raw paneer |
| 22:30 | Half cucumber |

Non-negotiables: **oil cap 3 tsp/day** (the whole margin lives here), paneer raw from a pasteurised/branded packet, 3+ litres water, no sugar in tea/coffee. Full detail is in `2-week-plan.md`.

The single biggest lever if you want it faster is **walking more (toward 5 km/day)** plus the Mon/Wed/Fri bodyweight circuit — not cutting food further, which would eat into protein and cost you muscle.
