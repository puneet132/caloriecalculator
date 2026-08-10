// Text-only call — drafts a short follow-up nudge email for an application already
// logged, given how long it's been and what was originally sent. Never re-attaches
// or regenerates the resume; a follow-up is just a polite check-in.
const { verifyIdToken, firestore } = require("./_firebaseAdmin");
const { decrypt } = require("./_crypto");
const { callProvider } = require("./_llm");

const FOLLOWUP_TOOL = {
  name: "record_followup",
  description: "Record a short follow-up email draft.",
  schema: {
    type: "object",
    properties: {
      subject: { type: "string" },
      body: { type: "string" }
    },
    required: ["subject", "body"]
  }
};

const SYSTEM = `Draft a short, polite follow-up email to a recruiter about a job application that's already been sent. Rules:
- Keep it brief — 3-5 sentences, not a repeat of the original application.
- Reference the role and company by name, and roughly how long ago the application went in.
- Reaffirm interest in one line, ask politely for a status update, don't be pushy or apologetic.
- Do not re-list qualifications or attach anything — that's already in the original email.
- Subject should reference the original, e.g. "Following up: Application for [Role]".
- Sign off with the name given in the profile's identity field.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { idToken, application, profile, daysSinceApplied, provider, model } = req.body || {};
  let uid;
  try {
    uid = (await verifyIdToken(idToken)).uid;
  } catch (e) {
    return res.status(401).json({ error: "please sign in again" });
  }
  if (!application || !profile) return res.status(400).json({ error: "missing application or profile" });
  if (!provider || !model) return res.status(400).json({ error: "missing provider/model" });

  let apiKey;
  try {
    const doc = await firestore().collection("serverOnly_providerKeys").doc(`${uid}_${provider}`).get();
    if (!doc.exists) return res.status(400).json({ error: `no ${provider} key configured — add one in Settings` });
    apiKey = decrypt(doc.data().encryptedKey);
  } catch (e) {
    return res.status(500).json({ error: "could not load your provider key" });
  }

  const text = `ORIGINAL APPLICATION:\nCompany: ${application.company}\nRole: ${application.role}\nApplied: ${application.dateApplied} (${daysSinceApplied ?? "?"} days ago)\nOriginal email subject: ${application.email?.subject || ""}\nOriginal email body:\n${application.email?.body || ""}\n\nPROFILE IDENTITY:\n${JSON.stringify(profile.identity, null, 2)}\n\nDraft the follow-up.`;

  try {
    const result = await callProvider({ provider, model, apiKey, system: SYSTEM, text, tool: FOLLOWUP_TOOL });
    return res.status(200).json(result);
  } catch (err) {
    console.error("job-followup failed:", err);
    return res.status(502).json({ error: "follow-up draft failed — the model or provider may be unavailable right now" });
  }
};
