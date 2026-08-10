// Stores a user's provider API key, encrypted, in a Firestore collection the client
// SDK can never read or write (see firestore.rules). This endpoint never returns a
// key value once saved — only a boolean "configured" + a masked last-4 preview.
const { verifyIdToken, firestore } = require("./_firebaseAdmin");
const { encrypt } = require("./_crypto");

const PROVIDERS = ["anthropic", "openai", "gemini"];

async function validateKey(provider, apiKey) {
  try {
    if (provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "hi" }] })
      });
      return r.ok || r.status === 400; // 400 (e.g. bad model at some point) still proves the key authenticated
    }
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${apiKey}` } });
      return r.ok;
    }
    if (provider === "gemini") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      return r.ok;
    }
  } catch (e) {
    return false;
  }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { idToken, action, provider, apiKey } = req.body || {};
  let decoded;
  try {
    decoded = await verifyIdToken(idToken);
  } catch (e) {
    return res.status(401).json({ error: "invalid or expired session — please sign in again" });
  }
  const uid = decoded.uid;
  const db = firestore();

  if (action === "status") {
    try {
      const results = {};
      for (const p of PROVIDERS) {
        const doc = await db.collection("serverOnly_providerKeys").doc(`${uid}_${p}`).get();
        results[p] = doc.exists ? { configured: true, preview: doc.data().keyPreview || "", model: doc.data().model || "" } : { configured: false };
      }
      return res.status(200).json(results);
    } catch (e) {
      return res.status(500).json({ error: "could not load key status" });
    }
  }

  if (action === "remove") {
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: "unknown provider" });
    try {
      await db.collection("serverOnly_providerKeys").doc(`${uid}_${provider}`).delete();
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "could not remove key" });
    }
  }

  // default: save
  if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: "unknown provider" });
  if (!apiKey || apiKey.length < 8) return res.status(400).json({ error: "that doesn't look like a valid key" });

  const valid = await validateKey(provider, apiKey);
  if (!valid) return res.status(400).json({ error: "that key was rejected by the provider — double-check it and try again" });

  try {
    const encrypted = encrypt(apiKey);
    const preview = `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
    await db.collection("serverOnly_providerKeys").doc(`${uid}_${provider}`).set({
      uid, provider,
      encryptedKey: encrypted,
      keyPreview: preview,
      model: (req.body && req.body.model) || "",
      addedAt: new Date().toISOString()
    });
    return res.status(200).json({ ok: true, preview });
  } catch (e) {
    return res.status(500).json({ error: "could not save key" });
  }
};
