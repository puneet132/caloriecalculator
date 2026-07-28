# Snapply

**Screenshot a job. Send the application.**

Point it at a job posting — a screenshot, pasted text, or both — and it extracts the recruiter's
email, company, and role, checks the posting's requirements against your resume, and drafts the
application email. You review and edit, then download an `.eml` with your resume attached as a
real MIME part: open it in a mail client, or drag it into Gmail, and send.

Lives at `/email-responder/` and shares the Vercel project with the Fourteen app. Its service
worker is scoped to that directory so it doesn't displace the root one.

## Everyone brings their own API key

Each user pastes their own Anthropic API key, and the browser calls Anthropic **directly** —
the key never passes through this site's server, and usage bills to whoever's key it is. That
means you can share the deployment freely without paying for anyone else's drafts.

This uses Anthropic's `anthropic-dangerous-direct-browser-access` header, added specifically to
support the bring-your-own-key pattern. Keys live in `localStorage` on the user's own device.

**The honest caveat:** a key in `localStorage` is readable by any script running on the page. This
app loads no third-party scripts, no analytics, and no CDN, which is what makes that acceptable —
keep it that way. Anyone uneasy with the tradeoff can use a key scoped to a low spend limit, or
run their own copy.

### Deploying

Just push. No environment variables are needed, and with none set the app is BYOK-only:
`/api/draft-email` answers `402` and the UI asks the user for a key.

### Running it on your own key instead

For a **private** deployment where you want to cover usage yourself, set both:

```
ANTHROPIC_API_KEY = sk-ant-...
ALLOW_SERVER_KEY  = true
```

Both are required — setting the key alone does nothing. That's deliberate: it means a fork, a
preview deployment, or a shared link can never quietly spend your credit. Anyone with a key of
their own still overrides the server path; the browser only falls back to the proxy when no
personal key is set.

`vercel.json` sets `maxDuration: 60` for the function, since the 10s default isn't enough for a
call that reads a screenshot and a resume.

## Using it

Set your sending address, paste your API key, and upload your resume once — all three persist in
this browser. After that each application is: paste or drop the posting → **Draft the email** →
review → **Download .eml**.

`Ctrl/Cmd+V` pastes a screenshot straight onto the page.

## What it flags

The prompt is written to be honest rather than flattering, because a recruiter spots an
overstated resume in seconds:

- **Requirements you don't meet** — a mandatory qualification your resume doesn't show, a domain
  you haven't worked in, a years-of-experience floor you're short of. Shown in red so you can
  decide whether the application is worth sending at all.
- **Verify these** — anything cropped, blurry, or ambiguous in the screenshot.
- **Resume tweaks** — reordering and re-emphasis only. It will not suggest inventing experience.

The recruiter's address is taken verbatim from the source; it is never guessed or auto-completed.
If none is found, the field comes back empty and you fill it in yourself.

## Resume formats

- **PDF** — sent to Claude as a document block and read natively.
- **.docx** — text is extracted in the browser (a `.docx` is a ZIP; the app reads
  `word/document.xml` with `DecompressionStream`) and only the text is sent. Claude has no native
  `.docx` input, so this keeps the app dependency-free instead of adding a server-side parser.

Either way, the original file is what gets attached to the `.eml`.

## Sending

Snapply produces an `.eml` and a `mailto:` link. It does not send mail itself, and it does not
create Gmail drafts — that needs a Google Cloud project with the Gmail API enabled, an OAuth
consent screen, and a token exchange, all of which each user would have to set up for themselves.
`.eml` is the zero-setup path and keeps a human in the loop before anything reaches a recruiter.

Note `mailto:` cannot carry attachments — use the `.eml` when the resume needs to go with it.

## Cost

Roughly a screenshot (~1–2k image tokens) plus a resume and the reply, at Opus 5 rates
($5/$25 per Mtok) with `effort: "medium"` — ballpark a few cents per application, billed to
whoever's key is in use. Drop `output_config.effort` to `"low"` in `draft-request.js` to trade
some quality for less spend.

## Layout

| File | Role |
| --- | --- |
| `index.html` | The whole UI — no build step, no dependencies |
| `draft-request.js` | Model, prompt, and response schema. Shared verbatim by the browser and the proxy so they can't drift |
| `sw.js` | Offline shell, scoped to this directory. Never caches `/api/` |
| `../api/draft-email.js` | Optional owner-key proxy, off unless `ALLOW_SERVER_KEY=true` |
