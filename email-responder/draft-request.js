// Shared request builder — the single source of truth for the model, prompt, and
// response schema. Loaded as a plain <script> in the browser (window.DraftRequest)
// and require()'d by the serverless proxy, so the two paths can never drift apart.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DraftRequest = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MODEL = "claude-opus-5";
  var API_URL = "https://api.anthropic.com/v1/messages";
  var ANTHROPIC_VERSION = "2023-06-01";
  var ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

  // Every field is a plain string, string[], or boolean — structured outputs reject
  // nulls and length/numeric constraints. "Not found" is the empty string.
  var RESPONSE_SCHEMA = {
    type: "object",
    properties: {
      recruiterEmail: { type: "string", description: "Recruiter's email address exactly as it appears in the source. Empty string if none is present." },
      recruiterName: { type: "string" },
      company: { type: "string" },
      role: { type: "string" },
      location: { type: "string" },
      keyRequirements: { type: "array", items: { type: "string" } },
      gaps: {
        type: "array",
        items: { type: "string" },
        description: "Honest mismatches between the resume and the stated requirements (missing qualification, wrong domain, years short). Empty array if none."
      },
      subject: { type: "string" },
      emailBody: { type: "string", description: "Full email body including greeting and sign-off, plain text with real newlines." },
      resumeNotes: {
        type: "array",
        items: { type: "string" },
        description: "Specific suggestions for tailoring the resume to this role. Empty array if it already fits."
      },
      ambiguities: {
        type: "array",
        items: { type: "string" },
        description: "Anything unclear or unreadable in the input that the user should verify before sending."
      },
      confident: { type: "boolean", description: "True only if recruiter email, company, and role were all identified unambiguously." }
    },
    required: [
      "recruiterEmail", "recruiterName", "company", "role", "location",
      "keyRequirements", "gaps", "subject", "emailBody",
      "resumeNotes", "ambiguities", "confident"
    ],
    additionalProperties: false
  };

  function buildInstructions(senderEmail) {
    return "You are helping " + senderEmail + " apply for a job. You are given a job posting (as a screenshot, pasted text, or both) and their resume.\n\n" +
"Extract the details, then write the application email.\n\n" +
"Extraction rules:\n" +
"- Take the recruiter's email address verbatim from the source. Never invent, complete, or correct an address. If none is visible, return an empty string and say so in ambiguities.\n" +
"- If the posting is cropped, blurry, or a detail is genuinely unreadable, record that in ambiguities rather than guessing.\n" +
"- Set confident to true only when the recruiter email, company, and role are all unambiguous.\n\n" +
"Honesty rules — these matter more than making the application look good:\n" +
"- Compare the resume against the stated requirements and list every real mismatch in gaps: a mandatory qualification the resume doesn't show, a required domain they haven't worked in, a years-of-experience floor they don't meet.\n" +
"- Never imply the candidate has a credential or experience the resume doesn't show. Surfacing genuinely relevant adjacent experience is fair; inventing is not, and a recruiter will spot it in seconds.\n" +
"- When there is a hard mismatch, name it in one plain sentence in the email and let the track record argue the rest. It reads as self-aware, not as a wasted application.\n" +
"- resumeNotes must only suggest reordering, re-emphasising, or rewording what is already in the resume. Never suggest adding experience the candidate does not have.\n\n" +
"Email rules:\n" +
"- Open by naming the role and company specifically — never \"your open position\".\n" +
"- Two or three sentences connecting their actual background to what this posting asks for. Specific, not \"I would be a great fit\".\n" +
"- Mention the resume is attached.\n" +
"- Close with a low-pressure call to action, then sign off with the candidate's name from the resume.\n" +
"- Keep it under 150 words. Recruiters skim.\n" +
"- Plain text with real newlines. No markdown, no placeholders like [Your Name].\n\n" +
"Subject line: \"Application for <Role> at <Company> — <Candidate Name>\".";
  }

  // Throws on invalid input so both callers reject the same things the same way.
  function buildRequestBody(input) {
    var senderEmail = input.senderEmail;
    var jobText = (input.jobText || "").trim();

    if (!senderEmail) throw new Error("Missing field: senderEmail");
    if (!input.screenshotBase64 && !jobText) throw new Error("Provide a job posting — a screenshot, pasted text, or both.");
    if (!input.resumePdfBase64 && !(input.resumeText || "").trim()) throw new Error("Provide a resume — a PDF, or text extracted from a .docx.");
    if (input.screenshotBase64 && ALLOWED_IMAGE_TYPES.indexOf(input.screenshotType) === -1) {
      throw new Error("Unsupported image type: " + (input.screenshotType || "unknown") + ". Use PNG, JPEG, GIF, or WebP.");
    }

    // Images and documents must precede the text that refers to them.
    var content = [];
    if (input.screenshotBase64) {
      content.push({ type: "image", source: { type: "base64", media_type: input.screenshotType, data: input.screenshotBase64 } });
    }
    if (input.resumePdfBase64) {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.resumePdfBase64 } });
    }

    var text = buildInstructions(senderEmail);
    if (input.screenshotBase64) text += "\n\nThe image above is the job posting.";
    if (jobText) text += "\n\nJob posting text:\n" + jobText;
    if (input.resumePdfBase64) text += "\n\nThe attached PDF is the candidate's resume.";
    if ((input.resumeText || "").trim()) text += "\n\nCandidate's resume:\n" + input.resumeText.trim();
    content.push({ type: "text", text: text });

    return {
      model: MODEL,
      // Thinking is on by default on Opus 5 and shares this budget with the reply,
      // so leave headroom or the email truncates mid-sentence.
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
      messages: [{ role: "user", content: content }]
    };
  }

  // Turns a raw Messages API response into a draft, or throws a message worth showing.
  function parseResponse(data) {
    if (data.stop_reason === "refusal") {
      throw new Error("The request was declined by safety classifiers. Try rephrasing or removing sensitive content.");
    }
    if (data.stop_reason === "max_tokens") {
      throw new Error("The response was cut off before completing. Try a shorter job posting or resume.");
    }
    var block = (data.content || []).filter(function (b) { return b.type === "text"; })[0];
    if (!block || !block.text) throw new Error("The API returned no content.");
    try {
      return JSON.parse(block.text);
    } catch (e) {
      throw new Error("The API returned malformed JSON.");
    }
  }

  return {
    MODEL: MODEL,
    API_URL: API_URL,
    ANTHROPIC_VERSION: ANTHROPIC_VERSION,
    ALLOWED_IMAGE_TYPES: ALLOWED_IMAGE_TYPES,
    RESPONSE_SCHEMA: RESPONSE_SCHEMA,
    buildRequestBody: buildRequestBody,
    parseResponse: parseResponse
  };
});
