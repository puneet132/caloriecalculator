// Normalizes structured-output (tool-use) calls across Anthropic, OpenAI, and Gemini
// behind one function, so the extract/generate/followup endpoints don't each duplicate
// three providers' worth of request/response shapes.
//
// Keep MODEL_REGISTRY in sync with job-agent/providers.js on the client — this list
// only drives server-side... nothing, actually; the client sends whatever model id
// it has, this registry exists so other server code (if any) can validate/label it.
const MODEL_REGISTRY = {
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" }
  ],
  openai: [
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 Mini" },
    { id: "gpt-4o", label: "GPT-4o" }
  ],
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-flash-latest", label: "Gemini Flash (latest)" }
  ]
};

function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = k === "type" && typeof v === "string" ? v.toUpperCase() : toGeminiSchema(v);
    }
    return out;
  }
  return node;
}

async function callAnthropic({ model, apiKey, system, text, image, tool }) {
  const content = image
    ? [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } }, { type: "text", text }]
    : text;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: 4000, system,
      messages: [{ role: "user", content }],
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
      tool_choice: { type: "tool", name: tool.name }
    })
  });
  if (!r.ok) throw new Error(`Anthropic API error: ${await r.text()}`);
  const data = await r.json();
  const toolUse = (data.content || []).find(b => b.type === "tool_use");
  if (!toolUse) throw new Error("Anthropic returned no structured result");
  return toolUse.input;
}

async function callOpenAI({ model, apiKey, system, text, image, tool }) {
  const userContent = image
    ? [{ type: "text", text }, { type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.data}` } }]
    : text;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
      tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.schema } }],
      tool_choice: { type: "function", function: { name: tool.name } }
    })
  });
  if (!r.ok) throw new Error(`OpenAI API error: ${await r.text()}`);
  const data = await r.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("OpenAI returned no structured result");
  return JSON.parse(call.function.arguments);
}

async function callGemini({ model, apiKey, system, text, image, tool }) {
  const parts = image ? [{ text }, { inlineData: { mimeType: image.mediaType, data: image.data } }] : [{ text }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.schema) }] }],
      tool_config: { function_calling_config: { mode: "ANY", allowed_function_names: [tool.name] } }
    })
  });
  if (!r.ok) throw new Error(`Gemini API error: ${await r.text()}`);
  const data = await r.json();
  const partWithCall = (data.candidates?.[0]?.content?.parts || []).find(p => p.functionCall);
  if (!partWithCall) throw new Error("Gemini returned no structured result");
  return partWithCall.functionCall.args;
}

// tool: { name, description, schema } — schema is a plain JSON-schema object shared
// across all three providers (converted to Gemini's uppercase-type dialect internally).
async function callProvider({ provider, model, apiKey, system, text, image, tool }) {
  if (provider === "anthropic") return callAnthropic({ model, apiKey, system, text, image, tool });
  if (provider === "openai") return callOpenAI({ model, apiKey, system, text, image, tool });
  if (provider === "gemini") return callGemini({ model, apiKey, system, text, image, tool });
  throw new Error(`unknown provider: ${provider}`);
}

module.exports = { callProvider, MODEL_REGISTRY, PROVIDERS: Object.keys(MODEL_REGISTRY) };
