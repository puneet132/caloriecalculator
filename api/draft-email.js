// Optional owner-only proxy. Public deployments should leave this OFF and let each
// user bring their own key — the browser then calls Anthropic directly and no user's
// credential ever touches this server.
//
// Enable for a private deploy by setting BOTH:
//   ANTHROPIC_API_KEY        = sk-ant-...
//   ALLOW_SERVER_KEY         = true
//
// With ALLOW_SERVER_KEY unset, this endpoint always answers 402 and the client falls
// back to the user's own key. That default is deliberate: it means forking or sharing
// the deployment can never bill the owner.
//
// This endpoint never accepts a caller-supplied API key. Bring-your-own-key goes
// browser -> Anthropic, so there is no path by which one user's key reaches this code.

const DraftRequest = require("../email-responder/draft-request.js");

// Vercel caps serverless request bodies at ~4.5MB; base64 inflates ~33%. Guard below
// that to fail with a clear message instead of an opaque platform 413. The direct
// browser path has no such limit (Anthropic accepts up to 32MB).
const MAX_TOTAL_BASE64 = 3_500_000;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (process.env.ALLOW_SERVER_KEY !== "true") {
    res.status(402).json({
      error: "This deployment doesn't provide an API key. Add your own Anthropic API key in the app to continue.",
      code: "byok_required"
    });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ALLOW_SERVER_KEY is on but ANTHROPIC_API_KEY is not set." });
    return;
  }

  const body = req.body || {};
  const totalBase64 = (body.screenshotBase64 || "").length + (body.resumePdfBase64 || "").length;
  if (totalBase64 > MAX_TOTAL_BASE64) {
    res.status(413).json({ error: "Screenshot and resume are too large together. Use a smaller screenshot, or a text resume instead of a PDF." });
    return;
  }

  let requestBody;
  try {
    requestBody = DraftRequest.buildRequestBody(body);
  } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }

  try {
    const apiRes = await fetch(DraftRequest.API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": DraftRequest.ANTHROPIC_VERSION
      },
      body: JSON.stringify(requestBody)
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text().catch(() => "");
      res.status(502).json({ error: `Anthropic request failed (${apiRes.status})`, detail: detail.slice(0, 500) });
      return;
    }

    const data = await apiRes.json();
    let draft;
    try {
      draft = DraftRequest.parseResponse(data);
    } catch (err) {
      res.status(502).json({ error: err.message });
      return;
    }

    res.status(200).json({ draft, usage: data.usage });
  } catch (err) {
    res.status(500).json({ error: "Draft generation failed", detail: String((err && err.message) || err) });
  }
};
