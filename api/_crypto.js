// AES-256-GCM encrypt/decrypt for provider API keys at rest in Firestore.
// ENCRYPTION_KEY is a 64-char hex string (32 bytes) — generate with `openssl rand -hex 32`.
const crypto = require("crypto");

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error("ENCRYPTION_KEY must be a 64-char hex string (32 bytes)");
  return Buffer.from(hex, "hex");
}

function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: tag.toString("base64") };
}

function decrypt({ iv, ciphertext, tag }) {
  const key = getKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

module.exports = { encrypt, decrypt };
