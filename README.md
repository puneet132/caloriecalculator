# Fourteen — daily coach

A static PWA. No build step, no dependencies, no backend. Data lives in `localStorage` on your device.

```
index.html      landing (3D scroll) + the tracker
manifest.json   install metadata
sw.js           service worker — makes it work offline
vercel.json     stops the browser caching sw.js
icons/          192, 512, and maskable
```

## Deploy to Vercel

**Option A — drag and drop (fastest)**

1. Go to vercel.com → **Add New → Project**
2. Drag this whole folder onto the drop zone
3. Framework preset: **Other**. Leave build command and output directory empty.
4. Deploy. You get a `*.vercel.app` URL in about 20 seconds.

**Option B — CLI**

```bash
npm i -g vercel
cd coach-pwa
vercel          # preview
vercel --prod   # live
```

**Option C — GitHub (best if you'll keep tweaking it)**

```bash
git init && git add . && git commit -m "fourteen"
gh repo create fourteen --public --source=. --push
```
Then import the repo on Vercel. Every push redeploys automatically.

## Install on your phone

Open the deployed URL in Chrome (Android) or Safari (iPhone).

- **Android:** an Install banner appears at the bottom. Or menu → Add to Home screen.
- **iPhone:** Share → Add to Home Screen. (iOS ignores the install banner; this is the only route.)

Once installed it opens fullscreen with no browser chrome, and works with no internet.

## Changing the plan

Everything is at the top of the `<script>` block in `index.html`:

- `SABJI` / `DINNER` — the weekly rotations, indexed Sunday-first
- `WO` — workout days, `[1,3,5]` = Mon/Wed/Fri
- `CIRCUIT` — the exercises and reps
- `tasksFor()` — the daily checklist itself
- `S.startWeight` / `S.goal` — 85 and 78

After editing `index.html`, bump `CACHE` in `sw.js` (`fourteen-v1` → `v2`) or the old version stays cached on your phone.

## Resetting

Open the site, then in the browser console: `localStorage.removeItem("fourteen.v1")` and reload.

## What it does not do

It cannot send you notifications. Web push needs a server and a push subscription, and iOS only allows it for installed PWAs on iOS 16.4+. The phone reminders already set up in your Reminders app cover this — the app is where you tick things off, the reminders are what reach you.
