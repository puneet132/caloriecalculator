// Text call — takes the extracted JD plus the user's profile/master-resume data and
// returns a fit verdict, tailored resume content, and an email draft. Runs against
// whichever provider/model the user picked, using their own stored key.
const { verifyIdToken, firestore } = require("./_firebaseAdmin");
const { decrypt } = require("./_crypto");
const { callProvider, PROVIDERS } = require("./_llm");

const GENERATE_TOOL = {
  name: "record_application",
  description: "Record the fit assessment, tailored resume content, and email draft for this job application.",
  schema: {
    type: "object",
    properties: {
      fit: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["strong", "partial", "mismatch"] },
          reason: { type: "string" },
          gap_note: { type: "string" }
        },
        required: ["verdict", "reason"]
      },
      resume: {
        type: "object",
        properties: {
          title_line: { type: "string" },
          summary: { type: "string" },
          skills: { type: "array", items: { type: "string" } },
          bullet_sections: {
            type: "array",
            items: { type: "object", properties: { header: { type: "string" }, bullets: { type: "array", items: { type: "string" } } }, required: ["header", "bullets"] }
          },
          experience: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { type: "string" }, company: { type: "string" }, location: { type: "string" }, dates: { type: "string" }, bullets: { type: "array", items: { type: "string" } } },
              required: ["title", "company", "dates"]
            }
          },
          education: { type: "array", items: { type: "object", properties: { degree: { type: "string" }, school: { type: "string" }, dates: { type: "string" } }, required: ["degree", "school"] } },
          projects: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name", "description"] } },
          what_changed: { type: "array", items: { type: "string" } }
        }
      },
      email: {
        type: "object",
        properties: { subject: { type: "string" }, body: { type: "string" } },
        required: ["subject", "body"]
      }
    },
    required: ["fit", "email"]
  }
};

const SYSTEM = `You are helping one real person apply to jobs. You will receive a structured job description (JD) and his profile/master-resume data (the only source of truth about his experience).

Non-negotiable rule: you may reorder, reframe, retitle, and rephrase — you may NEVER invent. Every claim in the tailored resume and email must trace back to something present in the profile data. If the JD wants a tool, certification, domain, or years of experience that isn't in the profile, leave it out of the resume entirely — do not imply it. If it's a real gap worth naming, put one honest line about it in fit.gap_note and let the email address it, don't hide it.

Fit assessment must be a thoughtful judgment call, not a rubber stamp:
- "mismatch" for: a required degree/qualification the profile doesn't show, an experience band the profile is well above (not just meeting or slightly under), or a role explicitly targeting a different background than the profile's.
- "partial" for a real but small/explainable gap — still worth applying, name the gap honestly.
- "strong" when the profile's domain, experience band, and core skills line up with the JD.

When verdict is "mismatch", still fill in resume/email fields as best you can (the client decides whether to show them if the user overrides) but make fit.reason concrete and specific.

Email tone: concise, human, on-point — not stiff, not templated-sounding. One line on what role/company and current position framing, then 3-5 bullets each mapped to a specific JD requirement with real metrics from the profile, then an optional one-line honest gap acknowledgment if fit is partial, then any explicitly-requested fields (CTC/notice period/etc.) if the JD asked and answers were provided, then a closing line mentioning the attached resume. Sign off with the name from the profile's identity field. Subject line: "Application for [Role] – [Location]" unless the JD specifies its own format — honor that format exactly when given.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { idToken, jd, profile, provider, model } = req.body || {};
  let uid;
  try {
    uid = (await verifyIdToken(idToken)).uid;
  } catch (e) {
    return res.status(401).json({ error: "please sign in again" });
  }
  if (!jd || !profile) return res.status(400).json({ error: "missing jd or profile" });
  if (!PROVIDERS.includes(provider) || !model) return res.status(400).json({ error: "missing or unknown provider/model" });

  let apiKey;
  try {
    const doc = await firestore().collection("serverOnly_providerKeys").doc(`${uid}_${provider}`).get();
    if (!doc.exists) return res.status(400).json({ error: `no ${provider} key configured — add one in Settings` });
    apiKey = decrypt(doc.data().encryptedKey, `${uid}_${provider}`);
  } catch (e) {
    return res.status(500).json({ error: "could not load your provider key" });
  }

  const text = `JOB DESCRIPTION (extracted from a screenshot):\n${JSON.stringify(jd, null, 2)}\n\nPROFILE (the only source of truth — do not add facts beyond this):\n${JSON.stringify(profile, null, 2)}\n\nProduce the fit assessment, tailored resume content, and email draft.`;

  try {
    const result = await callProvider({ provider, model, apiKey, system: SYSTEM, text, tool: GENERATE_TOOL });
    return res.status(200).json(result);
  } catch (err) {
    console.error("job-generate failed:", err);
    return res.status(502).json({ error: "generation failed — the model or provider may be unavailable right now" });
  }
};
