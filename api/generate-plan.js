// Vercel serverless function — proxies plan generation to Gemini so the API key never
// reaches the client (this app is served publicly, a client-side key would be scraped).
// Ordered by contention, not by capability.
//
// This used to be the single model "gemini-flash-latest", which is an alias that
// always resolves to Google's newest Flash model — by definition the most
// in-demand thing on the platform. It answers capacity pressure with 503
// UNAVAILABLE ("this model is currently experiencing high demand"), and with no
// retry and nothing to fall back to, that one 503 was the whole feature failing.
// Observed live on 8 Sep: two 503s in a row, then a clean plan on the third try.
//
// Pinned older models are mature, far less contended, and entirely good enough
// for generating a diet plan.
// gemini-3.5-flash-lite first: it is what Google's own 404 body names as the
// replacement for the retired 2.5 line. gemini-flash-latest stays as a backstop
// because it is confirmed to exist — it answered with 503, not 404 — it is just
// the most contended thing on the platform, so it is no longer the first choice.
const MODELS = ["gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-2.5-flash"];

const geminiUrl = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Statuses worth trying the next model for.
//
// 404 belongs here, and leaving it out cost an outage: Google retires models on
// their own schedule ("this model is no longer available to new users"), and a
// hard failure on the first entry meant the fallback list was never reached —
// the chain that exists precisely to survive a dead model was skipped because
// the model was dead. 429/5xx are capacity and clear in seconds.
const ADVANCE = new Set([404, 429, 500, 502, 503, 504]);

const REQUEST_TIMEOUT_MS = 20000;
const TOTAL_BUDGET_MS = 50000;
const RETRY_PAUSE_MS = [400, 2000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    maintenanceCalories: { type: "integer" },
    targetCalories: { type: "integer" },
    targetProteinGrams: { type: "integer" },
    workoutDays: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, minItems: 1, maxItems: 6 },
    circuit: {
      type: "array",
      minItems: 5,
      maxItems: 7,
      items: {
        type: "object",
        properties: { name: { type: "string" }, reps: { type: "string" } },
        required: ["name", "reps"]
      }
    },
    mealRotation: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: {
        type: "object",
        properties: { lunch: { type: "string" }, dinner: { type: "string" } },
        required: ["lunch", "dinner"]
      }
    },
    dailyTasks: {
      type: "array",
      minItems: 8,
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          tm: { type: "string" },
          lbl: { type: "string" },
          k: { type: "string", enum: ["food", "move", "rule"] }
        },
        required: ["id", "tm", "lbl", "k"]
      }
    },
    habits: {
      type: "object",
      properties: {
        smoking: {
          type: "object",
          properties: { enabled: { type: "boolean" }, targetPerDay: { type: "integer" } },
          required: ["enabled", "targetPerDay"]
        },
        drinking: {
          type: "object",
          properties: { enabled: { type: "boolean" }, targetPerWeek: { type: "integer" } },
          required: ["enabled", "targetPerWeek"]
        }
      },
      required: ["smoking", "drinking"]
    }
  },
  required: ["summary", "maintenanceCalories", "targetCalories", "targetProteinGrams", "workoutDays", "circuit", "mealRotation", "dailyTasks", "habits"]
};

function buildPrompt(a) {
  return `You are a fitness and nutrition coach. Build a ${a.days}-day plan for someone going from ${a.currentWeight}kg to ${a.goalWeight}kg.

Profile:
- Goal type: ${a.goalType}
- Activity level: ${a.activityLevel}
- Diet: ${a.dietPref}
- Dislikes/allergies: ${a.dislikes || "none"}
- Smoking: ${a.smokingEnabled ? `currently ~${a.smokingCurrent}/day, wants to cut down` : "does not smoke"}
- Drinking: ${a.drinkingEnabled ? `currently ~${a.drinkingCurrent}/week, wants to cut down` : "does not drink"}

Rules:
- mealRotation must have exactly 7 entries, index 0 = Sunday, index 6 = Saturday. Each entry's "lunch" and "dinner" are short dish descriptions only (e.g. "Bhindi masala + 150g paneer", "Grilled chicken breast 150g + salad") consistent with the diet preference — vegetarian must not include any meat/egg, eggetarian may include eggs but not meat/fish, non-vegetarian should rotate different protein sources across the week.
- dailyTasks is a single template applied every day (8-12 items covering the full day: morning/hydration, pre-and-post workout nutrition, lunch, dinner, evening habits, hydration/oil rules). It must include exactly one task whose "lbl" contains the literal placeholder "{LUNCH}" and exactly one whose "lbl" contains the literal placeholder "{DINNER}" — these get the day's rotation substituted in on the client. Do not put actual food names in the lunch/dinner task lbl, only the placeholder plus the fixed part of the sentence (e.g. "3 roti + {LUNCH} + salad"). Order the array chronologically by "tm" (earliest first). Only use tm:"all day" for rules with no specific time (e.g. an oil or total-water cap) — anything with an actual moment in the day (even a habit reminder) must get a real time like "07:00", not "all day".
- workoutDays are 0-6 (Sun=0) — pick 3 days for a beginner, more for higher activity levels.
- circuit is 5-7 bodyweight exercises with rep ranges, ordered warm-up to harder.
- Calorie/protein numbers must be realistic for the stated weights, timeframe, and goal type — do not recommend a deficit that implies losing more than ~1kg/week.
- habits.smoking/drinking "enabled" should mirror whether the person reported that habit at all; if enabled, targetPerDay/targetPerWeek should be a sensible reduction step-down from their current amount, not zero unless they're already at zero.
- summary is 2-4 plain sentences explaining the calorie math and the single biggest lever for this specific person, in the voice of a direct, no-nonsense coach.

Return only the plan, matching the response schema exactly.`;
}

async function requestPlan(model, apiKey, payload) {
  // The key goes in a header, not the URL, so it never lands in request logs.
  const r = await fetch(geminiUrl(model), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    const err = new Error(`Gemini request failed (${r.status})`);
    err.status = r.status;
    err.detail = errText.slice(0, 500);
    throw err;
  }
  return r.json();
}

// Walk the models on capacity errors, then walk them once more after a pause.
// A bad key or a malformed request fails identically on every model, so only
// the statuses in ADVANCE (and timeouts) move on; anything else throws at once.
// The whole thing stops before Vercel's 60-second function limit.
async function generateWithFallback(apiKey, payload) {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let lastErr = null;
  for (let pass = 0; pass < 2; pass++) {
    for (const model of MODELS) {
      if (Date.now() > deadline) throw lastErr || new Error("Timed out");
      try {
        return { data: await requestPlan(model, apiKey, payload), model };
      } catch (err) {
        const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
        if (timedOut) err.status = 504;
        lastErr = err;
        if (!ADVANCE.has(err.status)) throw err;
        await sleep(pass === 0 ? RETRY_PAUSE_MS[0] : RETRY_PAUSE_MS[1]);
      }
    }
  }
  throw lastErr;
}

// ---- input checking ----
const DIETS = ["vegetarian", "eggetarian", "non-vegetarian"];
const GOALS = ["fat loss", "muscle gain", "recomp (fat loss + muscle)", "general fitness"];
const ACTIVITY = ["sedentary", "light", "moderate", "active"];

// Returns { value } with a cleaned profile, or { error } with a message for the user.
// Free text is length-limited and stripped of line breaks before it goes into the prompt.
function parseProfile(body) {
  let a = body;
  if (typeof a === "string") {
    try { a = JSON.parse(a); } catch { a = null; }
  }
  if (!a || typeof a !== "object") return { error: "Send the profile as JSON." };
  const num = (v) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : NaN);
  const currentWeight = num(a.currentWeight), goalWeight = num(a.goalWeight), days = Math.round(num(a.days));
  if (!(currentWeight >= 30 && currentWeight <= 250)) return { error: "Current weight must be between 30 and 250 kg." };
  if (!(goalWeight >= 30 && goalWeight <= 250)) return { error: "Goal weight must be between 30 and 250 kg." };
  if (!(days >= 3 && days <= 90)) return { error: "Days must be between 3 and 90." };
  if (!DIETS.includes(a.dietPref)) return { error: "Choose a diet." };
  if (!GOALS.includes(a.goalType)) return { error: "Choose a goal type." };
  if (!ACTIVITY.includes(a.activityLevel)) return { error: "Choose an activity level." };
  const count = (v, max) => Math.min(max, Math.max(0, Math.round(num(v)) || 0));
  const dislikes = typeof a.dislikes === "string" ? a.dislikes.replace(/[\r\n\t]+/g, " ").replace(/[<>{}`]/g, "").trim().slice(0, 200) : "";
  return {
    value: {
      currentWeight, goalWeight, days,
      dietPref: a.dietPref, goalType: a.goalType, activityLevel: a.activityLevel,
      smokingEnabled: a.smokingEnabled === true, smokingCurrent: count(a.smokingCurrent, 100),
      drinkingEnabled: a.drinkingEnabled === true, drinkingCurrent: count(a.drinkingCurrent, 200),
      dislikes
    }
  };
}

// ---- rate limit ----
// Best effort only: this memory is per server instance and is lost when the
// instance restarts, so it slows down casual abuse of the API key but is not a
// guarantee. A shared store (e.g. Vercel KV / Upstash) would be needed for that.
const RATE_LIMIT = 6, RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();
function rateLimited(ip, now = Date.now()) {
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) { hits.set(ip, recent); return true; }
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  return false;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("generate-plan: GEMINI_API_KEY is not set");
    res.status(500).json({ error: "Plan building isn't set up on this site yet." });
    return;
  }

  const parsed = parseProfile(req.body);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const ip = String((req.headers && req.headers["x-forwarded-for"]) || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) {
    res.status(429).json({ error: "That's a lot of plans in a short time. Try again in a few minutes." });
    return;
  }

  const payload = {
    contents: [{ parts: [{ text: buildPrompt(parsed.value) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.6
    }
  };

  let data;
  try {
    ({ data } = await generateWithFallback(apiKey, payload));
  } catch (err) {
    // Upstream detail goes to the server log, not to the browser.
    console.error("generate-plan: upstream failure", err && err.status, err && (err.detail || err.message));
    res.status(502).json({
      error: ADVANCE.has(err && err.status)
        ? "The AI service is busy right now. Your answers are fine — try again in a minute."
        : "The AI service rejected the request. Try again later."
    });
    return;
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    res.status(502).json({ error: "The AI service returned an empty plan. Try again." });
    return;
  }

  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    res.status(502).json({ error: "The AI service returned an unreadable plan. Try again." });
    return;
  }
  if (!plan || !Array.isArray(plan.mealRotation) || plan.mealRotation.length !== 7 || !Array.isArray(plan.dailyTasks)) {
    res.status(502).json({ error: "The plan came back incomplete. Try again." });
    return;
  }

  res.status(200).json({ plan });
}

module.exports = handler;
// Exposed for tests.
module.exports.parseProfile = parseProfile;
module.exports.rateLimited = rateLimited;
module.exports.RETRY_PAUSE_MS = RETRY_PAUSE_MS;
