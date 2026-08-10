// Vision call — takes a base64 screenshot of a job posting and returns structured JD
// data. Runs against whichever provider/model the signed-in user picked, using their
// own encrypted, server-only stored key. The key never reaches the client.
const { verifyIdToken, firestore } = require("./_firebaseAdmin");
const { decrypt } = require("./_crypto");
const { callProvider, PROVIDERS } = require("./_llm");

const EXTRACT_TOOL = {
  name: "record_job_posting",
  description: "Record structured data extracted from a screenshot of a job posting.",
  schema: {
    type: "object",
    properties: {
      readable: { type: "boolean", description: "false if the image is too cropped/blurry/unrelated to extract a job posting from" },
      unreadable_reason: { type: "string", description: "set only when readable is false" },
      multiple_roles: { type: "boolean", description: "true if the screenshot contains more than one distinct job posting/role" },
      role_candidates: { type: "array", description: "only when multiple_roles is true — one short label per role found", items: { type: "string" } },
      company: { type: "string" },
      role_title: { type: "string" },
      location: { type: "string" },
      work_mode: { type: "string", enum: ["onsite", "hybrid", "remote", "unspecified"] },
      experience_min: { type: "number" },
      experience_max: { type: "number" },
      recruiter_name: { type: "string" },
      recruiter_email: { type: "string", description: "empty string if no email/contact address is visible anywhere in the image" },
      requirements: { type: "array", items: { type: "string" } },
      domain: { type: "string" },
      explicitly_requested_fields: {
        type: "array",
        description: "fields the posting explicitly asks applicants to state — use current_ctc, expected_ctc, notice_period, availability where they apply",
        items: { type: "string" }
      },
      keywords: { type: "array", description: "the JD's own vocabulary, verbatim", items: { type: "string" } },
      subject_format_hint: { type: "string", description: "empty string unless the posting specifies an exact application-email subject line format" }
    },
    required: ["readable", "multiple_roles", "company", "role_title", "recruiter_email", "requirements", "keywords"]
  }
};

const SYSTEM = "You extract structured data from screenshots of job postings (almost always LinkedIn, captured on a phone). Pull the JD's own wording for `requirements` and `keywords` — do not paraphrase or invent terms that aren't in the image. Ignore emoji, hashtags, and phone UI chrome (status bar, nav bar). If a recruiter email/contact address is not visible anywhere in the image, leave recruiter_email empty rather than guessing.";

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { idToken, image, mediaType, roleHint, provider, model } = req.body || {};
  let uid;
  try {
    uid = (await verifyIdToken(idToken)).uid;
  } catch (e) {
    return res.status(401).json({ error: "please sign in again" });
  }
  if (!image) return res.status(400).json({ error: "missing image" });
  if (!PROVIDERS.includes(provider) || !model) return res.status(400).json({ error: "missing or unknown provider/model" });

  let apiKey;
  try {
    const doc = await firestore().collection("serverOnly_providerKeys").doc(`${uid}_${provider}`).get();
    if (!doc.exists) return res.status(400).json({ error: `no ${provider} key configured — add one in Settings` });
    apiKey = decrypt(doc.data().encryptedKey, `${uid}_${provider}`);
  } catch (e) {
    return res.status(500).json({ error: "could not load your provider key" });
  }

  const text = roleHint
    ? `This screenshot has multiple roles. Extract ONLY the role matching: "${roleHint}". Ignore the other postings in the image.`
    : "Extract the job posting from this screenshot. If it's a status-bar/UI-chrome-only crop, or clearly not a job post, set readable=false. If more than one distinct role appears in the image, set multiple_roles=true and list short labels in role_candidates instead of guessing which one to extract.";

  try {
    const result = await callProvider({
      provider, model, apiKey, system: SYSTEM, text,
      image: { mediaType: mediaType || "image/jpeg", data: image },
      tool: EXTRACT_TOOL
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("job-extract failed:", err);
    return res.status(502).json({ error: "extraction failed — the model or provider may be unavailable right now" });
  }
};
