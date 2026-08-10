// Shared Firebase Admin SDK singleton for serverless functions. The service account
// credentials are base64-encoded into one env var (avoids newline-in-env-var pain
// with the raw private key) and never reach the client.
const admin = require("firebase-admin");

let app;
function getAdminApp() {
  if (app) return app;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured on the server");
  const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  app = admin.apps.length ? admin.apps[0] : admin.initializeApp({ credential: admin.credential.cert(json) });
  return app;
}

async function verifyIdToken(idToken) {
  if (!idToken) throw new Error("missing idToken");
  // checkRevoked:true rejects a token the moment its account is disabled/revoked,
  // instead of letting an already-issued token keep working until it naturally expires.
  return admin.auth(getAdminApp()).verifyIdToken(idToken, true);
}

function firestore() {
  return admin.firestore(getAdminApp());
}

module.exports = { getAdminApp, verifyIdToken, firestore };
