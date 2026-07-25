// Vercel serverless function — proxies plan generation to Gemini so the API key never
// reaches the client (this app is served publicly, a client-side key would be scraped).
const MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });
    return;
  }

  const a = req.body || {};
  const required = ["currentWeight", "goalWeight", "days", "dietPref", "goalType", "activityLevel"];
  for (const f of required) {
    if (a[f] === undefined || a[f] === null || a[f] === "") {
      res.status(400).json({ error: `Missing field: ${f}` });
      return;
    }
  }
  if (!(a.currentWeight > 30 && a.currentWeight < 250) || !(a.goalWeight > 30 && a.goalWeight < 250)) {
    res.status(400).json({ error: "Weight out of range" });
    return;
  }
  if (!(a.days >= 3 && a.days <= 90)) {
    res.status(400).json({ error: "Days must be between 3 and 90" });
    return;
  }

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(a) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.6
        }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => "");
      res.status(502).json({ error: `Gemini request failed (${geminiRes.status})`, detail: errText.slice(0, 500) });
      return;
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      res.status(502).json({ error: "Gemini returned no content" });
      return;
    }

    let plan;
    try {
      plan = JSON.parse(text);
    } catch {
      res.status(502).json({ error: "Gemini returned malformed JSON" });
      return;
    }

    res.status(200).json({ plan });
  } catch (err) {
    res.status(500).json({ error: "Plan generation failed", detail: String(err && err.message || err) });
  }
};
