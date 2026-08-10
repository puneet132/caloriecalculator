// Vercel serverless function — Claude vision call. Takes a base64 screenshot of a job
// post and returns structured JD data. The API key stays server-side only.
const MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const EXTRACT_TOOL = {
  name: "record_job_posting",
  description: "Record structured data extracted from a screenshot of a job posting.",
  input_schema: {
    type: "object",
    properties: {
      readable: { type: "boolean", description: "false if the image is too cropped/blurry/unrelated to extract a job posting from" },
      unreadable_reason: { type: "string", description: "set only when readable is false" },
      multiple_roles: {
        type: "boolean",
        description: "true if the screenshot contains more than one distinct job posting/role"
      },
      role_candidates: {
        type: "array",
        description: "only when multiple_roles is true — one short label per role found, e.g. 'Product Manager - Gurugram'",
        items: { type: "string" }
      },
      company: { type: "string" },
      role_title: { type: "string" },
      location: { type: "string" },
      work_mode: { type: "string", enum: ["onsite", "hybrid", "remote", "unspecified"] },
      experience_min: { type: "number" },
      experience_max: { type: "number" },
      recruiter_name: { type: "string" },
      recruiter_email: { type: "string", description: "empty string if no email/contact address is visible anywhere in the image" },
      requirements: { type: "array", items: { type: "string" } },
      domain: { type: "string", description: "industry/domain, e.g. BFSI, e-commerce, healthcare" },
      explicitly_requested_fields: {
        type: "array",
        description: "fields the posting explicitly asks applicants to state, using these exact tokens where they apply: current_ctc, expected_ctc, notice_period, availability. Add other short snake_case tokens for anything else explicitly requested.",
        items: { type: "string" }
      },
      keywords: {
        type: "array",
        description: "the JD's own vocabulary, verbatim — phrases and terms as written in the post, not paraphrased",
        items: { type: "string" }
      },
      subject_format_hint: { type: "string", description: "empty string unless the posting specifies an exact application-email subject line format" }
    },
    required: ["readable", "multiple_roles", "company", "role_title", "recruiter_email", "requirements", "keywords"]
  }
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });

  const { image, mediaType, roleHint } = req.body || {};
  if (!image) return res.status(400).json({ error: "missing image" });

  const instructionText = roleHint
    ? `This screenshot has multiple roles. Extract ONLY the role matching: "${roleHint}". Ignore the other postings in the image.`
    : "Extract the job posting from this screenshot. If it's a status-bar/UI-chrome-only crop, or clearly not a job post, set readable=false. If more than one distinct role appears in the image, set multiple_roles=true and list short labels in role_candidates instead of guessing which one to extract.";

  const body = {
    model: MODEL,
    max_tokens: 1500,
    system: "You extract structured data from screenshots of job postings (almost always LinkedIn, captured on a phone). Pull the JD's own wording for `requirements` and `keywords` — do not paraphrase or invent terms that aren't in the image. Ignore emoji, hashtags, and phone UI chrome (status bar, nav bar). If a recruiter email/contact address is not visible anywhere in the image, leave recruiter_email empty rather than guessing.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
          { type: "text", text: instructionText }
        ]
      }
    ],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "record_job_posting" }
  };

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(502).json({ error: "Claude API error", detail: errText });
    }

    const data = await r.json();
    const toolUse = (data.content || []).find(b => b.type === "tool_use");
    if (!toolUse) return res.status(502).json({ error: "no structured extraction returned" });

    return res.status(200).json(toolUse.input);
  } catch (err) {
    return res.status(500).json({ error: "extraction failed", detail: String(err) });
  }
};
