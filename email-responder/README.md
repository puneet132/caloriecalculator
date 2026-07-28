# Email Responder

A PWA that turns a job posting into a tailored application email with your resume attached.

Upload a screenshot of the posting (or paste the text), and it extracts the recruiter's email,
company, and role, compares the posting's requirements against your resume, and drafts the email.
Output is editable, then downloadable as an `.eml` with the resume attached as a real MIME part.

Lives at `/email-responder/` and shares the Vercel project with the Fourteen app. Its service
worker is scoped to that directory so it doesn't displace the root one.

## Deploy

1. **Set the API key** in Vercel → Project → Settings → Environment Variables:

   ```
   ANTHROPIC_API_KEY = sk-ant-...
   ```

   Server-side only — it is never sent to the browser. Redeploy after adding it.

2. **Push.** `vercel.json` already sets `maxDuration: 60` for `api/draft-email.js`; the default
   10s is not enough for an Opus 5 call that reads a screenshot and a resume.

3. Open `https://<your-app>.vercel.app/email-responder/` and "Add to Home Screen".

## Using it

Set your sending address and upload your resume once — both are kept in `localStorage`, so the
resume never leaves your device except as part of a drafting request. After that each application
is: paste/drop the posting → **Draft the email** → review → **Download .eml**.

Open the `.eml` in a mail client, or drag it into the Gmail compose window, and send.

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

The app produces an `.eml` and a `mailto:` link. It does not send mail itself, and it does not
create Gmail drafts — that needs a Google Cloud project with the Gmail API enabled, an OAuth
consent screen, and a token exchange. If you want that later, the seam is `api/draft-email.js`:
add a second function that takes the reviewed draft plus an OAuth access token and POSTs to
`gmail.users.drafts.create`. Until then, `.eml` is the zero-setup path and keeps a human in the
loop before anything reaches a recruiter.

Note `mailto:` cannot carry attachments — use the `.eml` when the resume needs to go with it.

## Cost

One draft is roughly a screenshot (~1–2k image tokens) plus a resume and the reply, at Opus 5
rates ($5/$25 per Mtok), with `effort: "medium"`. Ballpark a few cents per application. Drop
`output_config.effort` to `"low"` in `api/draft-email.js` to trade some quality for less spend.
