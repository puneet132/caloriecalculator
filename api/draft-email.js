// Vercel serverless function — proxies job-application drafting to the Anthropic
// Messages API so the API key never reaches the client (this app is served publicly,
// a client-side key would be scraped).
//
// Input  (POST JSON):
//   screenshotBase64  string  optional  base64 image of the job posting (no data: prefix)
//   screenshotType    string  optional  image mime type, e.g. "image/png"
//   jobText           string  optional  pasted job text (use instead of / alongside a screenshot)
//   resumePdfBase64   string  optional  base64 PDF resume — Claude reads PDFs natively
//   resumeText        string  optional  plain-text resume (used for .docx, extracted client-side)
//   senderEmail       string  required  the address the email will be sent from
//
// At least one of screenshotBase64 / jobText, and one of resumePdfBase64 / resumeText.

const MODEL = "claude-opus-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Vercel caps serverless request bodies at ~4.5MB. Base64 inflates ~33%, so guard
// below that to fail with a clear message instead of an opaque platform 413.
const MAX_TOTAL_BASE64 = 3_500_000;

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// Every field is a plain string or string[] — no nulls, no numeric/length constraints,
// since structured outputs reject those. "Not found" is the empty string.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    recruiterEmail: { type: "string", description: "Recruiter's email address exactly as it appears in the source. Empty string if none is present." },
    recruiterName: { type: "string", description: "Recruiter's name, or empty string." },
    company: { type: "string" },
    role: { type: "string" },
    location: { type: "string" },
    keyRequirements: { type: "array", items: { type: "string" } },
    gaps: {
      type: "array",
      items: { type: "string" },
      description: "Honest mismatches between the resume and stated requirements (missing degree, wrong domain, years short). Empty array if none."
    },
    subject: { type: "string" },
    emailBody: {
      type: "string",
      description: "The full email body including greeting and sign-off, as plain text with real newlines."
    },
    resumeNotes: {
      type: "array",
      items: { type: "string" },
      description: "Specific, factual suggestions for tailoring the resume to this role. Empty array if the resume already fits."
    },
    ambiguities: {
      type: "array",
      items: { type: "string" },
      description: "Anything unclear or unreadable in the input that the user should verify before sending."
    },
    confident: {
      type: "boolean",
      description: "True only if the recruiter email, company, and role were all identified unambiguously."
    }
  },
  required: [
    "recruiterEmail", "recruiterName", "company", "role", "location",
    "keyRequirements", "gaps", "subject", "emailBody",
    "resumeNotes", "ambiguities", "confident"
  ],
  additionalProperties: false
};

function buildInstructions(senderEmail) {
  return `You are helping ${senderEmail} apply for a job. You are given a job posting (as a screenshot, pasted text, or both) and their resume.

Extract the details, then write the application email.

Extraction rules:
- Take the recruiter's email address verbatim from the source. Never invent, complete, or correct an address. If no address is visible, return an empty string and say so in ambiguities.
- If the posting is cropped, blurry, or a detail is genuinely unreadable, record that in ambiguities rather than guessing.
- Set confident to true only when the recruiter email, company, and role are all unambiguous.

Honesty rules — these matter more than making the application look good:
- Compare the resume against the stated requirements and list every real mismatch in gaps: a mandatory qualification the resume doesn't show, a required domain they haven't worked in, a years-of-experience floor they don't meet.
- Never imply the candidate has a credential or experience the resume doesn't show. Surfacing genuinely relevant adjacent experience is fair; inventing is not, and a recruiter will spot it in seconds.
- When there is a hard mismatch, name it in one plain sentence in the email and let the track record argue the rest. It reads as self-aware, not as a wasted application.
- resumeNotes must only suggest reordering, re-emphasising, or rewording what is already in the resume. Never suggest adding experience the candidate does not have.

Email rules:
- Open by naming the role and company specifically — never "your open position".
- Two or three sentences connecting their actual background to what this posting asks for. Specific, not "I would be a great fit".
- Mention the resume is attached.
- Close with a low-pressure call to action, then sign off with the candidate's name from the resume.
- Keep it under 150 words. Recruiters skim.
- Plain text with real newlines. No markdown, no placeholders like [Your Name].

Subject line: "Application for <Role> at <Company> — <Candidate Name>".`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
    return;
  }

  const body = req.body || {};
  const { screenshotBase64, screenshotType, jobText, resumePdfBase64, resumeText, senderEmail } = body;

  if (!senderEmail) {
    res.status(400).json({ error: "Missing field: senderEmail" });
    return;
  }
  if (!screenshotBase64 && !(jobText && jobText.trim())) {
    res.status(400).json({ error: "Provide a job posting — a screenshot, pasted text, or both." });
    return;
  }
  if (!resumePdfBase64 && !(resumeText && resumeText.trim())) {
    res.status(400).json({ error: "Provide a resume — a PDF, or text extracted from a .docx." });
    return;
  }
  if (screenshotBase64 && !ALLOWED_IMAGE_TYPES.includes(screenshotType)) {
    res.status(400).json({ error: `Unsupported image type: ${screenshotType || "unknown"}. Use PNG, JPEG, GIF, or WebP.` });
    return;
  }

  const totalBase64 = (screenshotBase64 || "").length + (resumePdfBase64 || "").length;
  if (totalBase64 > MAX_TOTAL_BASE64) {
    res.status(413).json({ error: "Screenshot and resume are too large together. Use a smaller screenshot, or a text resume instead of a PDF." });
    return;
  }

  // Order matters: images and documents before the text that refers to them.
  const content = [];

  if (screenshotBase64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: screenshotType, data: screenshotBase64 }
    });
  }

  if (resumePdfBase64) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: resumePdfBase64 }
    });
  }

  let text = buildInstructions(senderEmail);
  if (screenshotBase64) text += `\n\nThe image above is the job posting.`;
  if (jobText && jobText.trim()) text += `\n\nJob posting text:\n${jobText.trim()}`;
  if (resumePdfBase64) text += `\n\nThe attached PDF is the candidate's resume.`;
  if (resumeText && resumeText.trim()) text += `\n\nCandidate's resume:\n${resumeText.trim()}`;

  content.push({ type: "text", text });

  try {
    const apiRes = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: MODEL,
        // Thinking is on by default on Opus 5 and shares this budget with the
        // response text, so leave headroom or the email truncates mid-sentence.
        max_tokens: 16000,
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: RESPONSE_SCHEMA }
        },
        messages: [{ role: "user", content }]
      })
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text().catch(() => "");
      res.status(502).json({ error: `Anthropic request failed (${apiRes.status})`, detail: detail.slice(0, 500) });
      return;
    }

    const data = await apiRes.json();

    // Safety classifiers can decline with HTTP 200 — check before reading content.
    if (data.stop_reason === "refusal") {
      res.status(422).json({ error: "The request was declined by safety classifiers. Try rephrasing or removing sensitive content." });
      return;
    }
    if (data.stop_reason === "max_tokens") {
      res.status(502).json({ error: "The response was cut off before completing. Try a shorter job posting or resume." });
      return;
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock || !textBlock.text) {
      res.status(502).json({ error: "Anthropic returned no content" });
      return;
    }

    let draft;
    try {
      draft = JSON.parse(textBlock.text);
    } catch {
      res.status(502).json({ error: "Anthropic returned malformed JSON" });
      return;
    }

    res.status(200).json({ draft, usage: data.usage });
  } catch (err) {
    res.status(500).json({ error: "Draft generation failed", detail: String((err && err.message) || err) });
  }
};
