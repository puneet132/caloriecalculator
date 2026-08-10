# Job Application Agent

A personal PWA for Puneet Gupta. The only input is an image — a screenshot of a job
posting (camera or gallery). The app extracts the JD, judges fit against a stored
profile, tailors a resume, drafts an email, and lets you review before sending.
Nothing auto-sends.

```
job-agent/
  index.html      the whole app — capture, review, log, profile screens
  manifest.json   install metadata
  sw.js           service worker — app-shell cache only (API calls always hit network)
  icons/          192, 512, maskable
../api/
  job-extract.js       Claude vision call — screenshot -> structured JD JSON
  job-generate.js      Claude text call — JD + profile -> fit verdict, tailored resume, email draft
  job-resume-docx.js   deterministic .docx builder (ATS-safe) from the generated resume content
```

## One-time setup: API key

The Claude API key must never sit in client code, so the three `/api/*` functions read
it from a server-side environment variable.

1. Vercel dashboard → your project → **Settings → Environment Variables**
2. Add `ANTHROPIC_API_KEY` = an Anthropic API key (Production + Preview)
3. Redeploy

Without this, `/api/job-extract` and `/api/job-generate` return a 500 with a clear
"not configured" error — the app degrades safely, it doesn't silently fail.

## Deploy

Same Vercel project as the rest of this repo works fine — `job-agent/` is just another
static path, and it shares `api/` with the existing app. Root `package.json` now
declares `docx` as a dependency; Vercel runs `npm install` automatically before
building the functions.

```bash
vercel          # preview
vercel --prod   # production
```

Or connect the GitHub repo in the Vercel dashboard — every push redeploys.

## Install on phone

Open the deployed `/job-agent/` URL in Chrome (Android) or Safari (iPhone), then
Add to Home Screen / Install. Camera capture uses `<input type="file" capture="environment">`,
which works from the installed PWA on both platforms.

## What's deferred (by design, per spec)

**Gmail OAuth draft creation.** The spec explicitly says to ship the `mailto:` +
`.docx` download fallback first so the app is useful before auth is wired up. That's
what v1 does: "Open in Mail App" builds a `mailto:` link (prefilled to/subject/body)
and the resume downloads separately for you to attach. Real Gmail API draft creation
(OAuth) is a clean next step once the core flow is proven out — it needs a Google
Cloud OAuth client and consent screen, which only you can set up.

**Full resume rendering in the review screen.** The review screen shows a text
summary of the tailored resume (title, summary, top skills, reframed bullets) so
you can sanity-check content before downloading. The actual formatted document is
only in the `.docx` — there's no in-browser Word-doc renderer.

## How the pieces fit together

1. **Capture** — camera/gallery, client-side downscale to ≤1600px JPEG before upload
   (keeps payloads small and API image costs down).
2. **Extract** (`job-extract.js`) — Claude vision, forced tool-use output, so the JSON
   shape is guaranteed rather than parsed out of prose. Flags unreadable images,
   multiple roles in one screenshot, and missing recruiter email — the client blocks
   or asks before proceeding in each case, per spec.
3. **Duplicate check** — client-side, keyed on lowercased `company|role_title` against
   the IndexedDB log, before any generation call is made (saves an API call on a
   screenshot you've already processed).
4. **Quick questions** — if the JD explicitly asks for CTC/notice period/etc., the
   client prompts with fields prefilled from the profile's standing answers, and
   writes any edits back to the profile so they're remembered next time.
5. **Generate** (`job-generate.js`) — one Claude call returns fit verdict + reason +
   gap, tailored resume content, and the email draft together, using the profile as
   the only source of truth. The system prompt hard-bans inventing facts and spells
   out the strong/partial/mismatch judgment criteria from the spec.
6. **Resume file** (`job-resume-docx.js`) — deterministic, not another Claude call:
   takes the structured resume content and lays it out with the `docx` library using
   only headings/paragraphs/bullets (no tables, text boxes, or images) for ATS
   compatibility.
7. **Review** — editable subject/body, resume text preview, "what changed and why"
   list, download button, mailto button. Every application (drafted, sent, or
   skipped-mismatch) gets logged to IndexedDB immediately, so the log is a real
   record even if you never hit send.

## Editing the profile

Identity and standing answers have their own form fields. The master resume
(experience, education, achievements, skills, projects) is edited as JSON in a
textarea — it's the ground truth every tailored resume and email is generated
from fresh, so keeping it structured (not a resume blob) is what makes accurate
tailoring possible. "Reset to default" restores the seed data if you want to start
over.
