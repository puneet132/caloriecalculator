// Vercel serverless function — Claude text call. Takes the extracted JD plus the user's
// profile/master-resume data and returns a fit verdict, a tailored resume structure, and
// an email draft. Never invents facts: every resume claim must trace back to profile data.
const MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const GENERATE_TOOL = {
  name: "record_application",
  description: "Record the fit assessment, tailored resume content, and email draft for this job application.",
  input_schema: {
    type: "object",
    properties: {
      fit: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["strong", "partial", "mismatch"] },
          reason: { type: "string", description: "one or two plain sentences explaining the verdict" },
          gap_note: { type: "string", description: "empty string if no gap; otherwise the specific honest gap (e.g. 'asks 5-8 yrs, you have 4+')" }
        },
        required: ["verdict", "reason"]
      },
      resume: {
        type: "object",
        description: "omit meaningful content only when fit.verdict is 'mismatch' and not overridden — still fill it in, the client decides whether to show it",
        properties: {
          title_line: { type: "string", description: "e.g. 'Product Manager | Product Owner' — mirrors the target role, built only from titles already in the profile" },
          summary: { type: "string", description: "2-4 sentences, rewritten around the JD's own language and priorities, using only facts present in the profile" },
          skills: { type: "array", items: { type: "string" }, description: "profile's skill list, reordered so JD-relevant items lead — no additions" },
          bullet_sections: {
            type: "array",
            description: "reframed achievement groupings, headers using JD vocabulary where the underlying claim is true",
            items: {
              type: "object",
              properties: {
                header: { type: "string" },
                bullets: { type: "array", items: { type: "string" } }
              },
              required: ["header", "bullets"]
            }
          },
          experience: {
            type: "array",
            description: "profile's work history, unaltered facts (titles/companies/dates), bullets may be reordered/reworded from profile achievements only",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                company: { type: "string" },
                location: { type: "string" },
                dates: { type: "string" },
                bullets: { type: "array", items: { type: "string" } }
              },
              required: ["title", "company", "dates"]
            }
          },
          education: {
            type: "array",
            items: {
              type: "object",
              properties: { degree: { type: "string" }, school: { type: "string" }, dates: { type: "string" } },
              required: ["degree", "school"]
            }
          },
          projects: {
            type: "array",
            description: "profile's projects, reordered/promoted by JD relevance, descriptions unaltered in substance",
            items: {
              type: "object",
              properties: { name: { type: "string" }, description: { type: "string" } },
              required: ["name", "description"]
            }
          },
          what_changed: {
            type: "array",
            description: "3-6 short bullets, plain language, explaining what was reframed/reordered and why for this specific JD",
            items: { type: "string" }
          }
        }
      },
      email: {
        type: "object",
        properties: {
          subject: { type: "string" },
          body: { type: "string", description: "plain text, ready to send, follow the tone spec: concise, human, on-point, not templated-sounding" }
        },
        required: ["subject", "body"]
      }
    },
    required: ["fit", "email"]
  }
};

const SYSTEM_PROMPT = `You are helping one real person, Puneet Gupta, apply to jobs. You will receive a structured job description (JD) and his profile/master-resume data (the only source of truth about his experience).

Non-negotiable rule: you may reorder, reframe, retitle, and rephrase — you may NEVER invent. Every claim in the tailored resume and email must trace back to something present in the profile data. If the JD wants a tool, certification, domain, or years of experience that isn't in the profile, leave it out of the resume entirely — do not imply it. If it's a real gap worth naming, put one honest line about it in fit.gap_note and let the email address it, don't hide it.

Fit assessment must be a thoughtful judgment call, not a rubber stamp:
- "mismatch" for: a required degree/qualification the profile doesn't show (e.g. a specific engineering discipline), an experience band the profile is well above (not just meeting or slightly under), or a role explicitly targeting a different background than product/BA (e.g. "for developers moving into product").
- "partial" for a real but small/explainable gap (e.g. JD wants 5-8 yrs, profile shows 4+) — still worth applying, name the gap honestly.
- "strong" when the profile's domain, experience band, and core skills line up with the JD.

When verdict is "mismatch", still fill in resume/email fields as best you can (the client will decide whether to show them, e.g. if the user overrides) but make fit.reason concrete and specific enough that the user trusts the judgment.

Email tone: concise, human, on-point — not stiff, not templated-sounding. Roughly: one line on what role/company and current position framing, then 3-5 bullets each mapped to a specific JD requirement with real metrics from the profile, then an optional one-line honest gap acknowledgment if fit is partial, then any explicitly-requested fields (CTC/notice period/etc.) if the JD asked for them and answers were provided, then a closing line mentioning the attached resume. Sign off "Best regards,\\nPuneet". Subject line: "Application for [Role] – [Location]" unless the JD specifies its own format — honor that format exactly when given.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });

  const { jd, profile } = req.body || {};
  if (!jd || !profile) return res.status(400).json({ error: "missing jd or profile" });

  const userText = `JOB DESCRIPTION (extracted from a screenshot):\n${JSON.stringify(jd, null, 2)}\n\nPROFILE (the only source of truth — do not add facts beyond this):\n${JSON.stringify(profile, null, 2)}\n\nProduce the fit assessment, tailored resume content, and email draft.`;

  const body = {
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }],
    tools: [GENERATE_TOOL],
    tool_choice: { type: "tool", name: "record_application" }
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
    if (!toolUse) return res.status(502).json({ error: "no structured result returned" });

    return res.status(200).json(toolUse.input);
  } catch (err) {
    return res.status(500).json({ error: "generation failed", detail: String(err) });
  }
};
