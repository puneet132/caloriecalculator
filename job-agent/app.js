import { auth, db, googleProvider, signInWithPopup, onAuthStateChanged, signOut } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* ---------- default profile (seed) ---------- */
const DEFAULT_PROFILE = {
  identity: {
    name: "Puneet Gupta",
    location: "Gurugram, India",
    phone: "+91-9602801140",
    email: "puneetgupta132@gmail.com",
    linkedin: "linkedin.com/in/puneetgupta132"
  },
  standingAnswers: {
    notice_period: "30 days",
    current_ctc: "",
    expected_ctc: "",
    location: "Gurugram",
    open_to_relocation: "yes"
  },
  resume: {
    experience_years: 4,
    domains: ["BFSI/insurance", "e-commerce", "supply chain", "US healthcare (HIPAA)"],
    headline_options: ["Product Manager", "Product Owner", "Business Systems Analyst", "Business Analyst"],
    experience: [
      {
        title: "Business Consultant (Product Owner / Business Systems Analyst)",
        company: "Kellton — deployed at Axis Max Life Insurance",
        location: "Gurugram, India",
        dates: "Aug 2025–Present",
        achievements: [
          "Led mSpace, a 0-to-1 insurance app, from concept to launch with zero critical go-live issues",
          "Drove 5,000+ customer activations and a 50% engagement uplift post-launch",
          "Cut cross-team requirement ambiguity by 40% through clearer PRDs/BRDs/FSDs",
          "Reduced post-launch production incidents by 50%",
          "Cut time-to-market by 30% using Value vs. Effort prioritization",
          "Improved feature ROI by 25% via Figma prototyping collaboration with UI/UX",
          "Authored 90+ artifacts: PRDs, BRDs, FSDs, user journeys, process flows",
          "Aligned 5+ Scrum teams around a single roadmap",
          "Onboarded 3+ international enterprise accounts within 3 months",
          "Won the Best Employee Award at Axis Max Life"
        ]
      },
      {
        title: "Business Analyst",
        company: "AppInventiv",
        location: "Noida, India",
        dates: "Oct 2022–Jul 2025",
        achievements: [
          "Authored requirement artifacts (PRDs, BRDs, FSDs, user journeys, process flows) across e-commerce, supply chain, and US healthcare (HIPAA) engagements",
          "Ran competitor benchmarking and gap analysis to shape product roadmaps",
          "Defined and tracked KPIs across multiple client engagements",
          "Won the Spotlight Award at AppInventiv"
        ]
      }
    ],
    education: [{ degree: "B.Tech, Computer Science", school: "GIT Jaipur", dates: "2017–2021" }],
    projects: [
      { name: "AI Shopping Copilot", description: "AI-assisted shopping copilot concept for a D2C e-commerce context — product discovery and conversational recommendations." },
      { name: "Fourteen", description: "A diet + workout coach PWA, built end-to-end with Claude Code — installable, offline-capable, personal fat-loss tracker." }
    ],
    skills: [
      "Roadmap strategy", "Prioritization (MoSCoW, Value vs. Effort)", "PRD/BRD/FSD authoring",
      "Gap analysis", "KPI definition & tracking", "Competitor benchmarking",
      "JIRA", "Confluence", "Figma", "Visio", "Balsamiq", "Miro", "Notion",
      "Firebase", "Amplitude", "Mixpanel", "Zendesk", "Basic SQL",
      "AI-assisted workflows (Claude/ChatGPT for PRD drafting, research synthesis, evaluating AI feature output)"
    ]
  }
};

/* ---------- provider metadata (client) ---------- */
const PROVIDER_META = {
  anthropic: { label: "Anthropic (Claude)", keyUrl: "https://console.anthropic.com/settings/keys", note: "Pay-as-you-go API pricing." },
  openai: { label: "OpenAI (ChatGPT)", keyUrl: "https://platform.openai.com/api-keys", note: "Pay-as-you-go API pricing." },
  gemini: { label: "Google (Gemini)", keyUrl: "https://aistudio.google.com/apikey", note: "Has a real free tier — easiest place to start." }
};
// Keep in sync with api/_llm.js MODEL_REGISTRY.
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

/* ---------- state ---------- */
let CURRENT_USER = null;
let PROFILE = null;
let PROVIDER_STATUS = { anthropic: { configured: false }, openai: { configured: false }, gemini: { configured: false } };
let SESSION = { imageB64: null, jd: null, generation: null, mismatchOverridden: false, provider: null, model: null };

/* ---------- nav ---------- */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + id).classList.add("active");
  document.querySelectorAll("header nav button[data-nav]").forEach(b => b.classList.remove("active"));
  const navBtn = document.querySelector(`header nav button[data-nav="${id}"]`);
  if (navBtn) navBtn.classList.add("active");
  window.scrollTo(0, 0);
}
document.addEventListener("click", e => {
  const el = e.target.closest("[data-nav]");
  if (!el) return;
  const id = el.getAttribute("data-nav");
  if (id === "log") renderLog();
  if (id === "profile") fillProfileForm();
  showScreen(id);
});

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- auth ---------- */
document.getElementById("btnGoogleSignIn").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    toast("Sign-in failed — try again");
  }
});
document.getElementById("btnSignOut").addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    CURRENT_USER = null;
    document.getElementById("topNav").style.display = "none";
    showScreen("login");
    return;
  }
  CURRENT_USER = user;
  document.getElementById("topNav").style.display = "flex";
  document.getElementById("userAvatar").src = user.photoURL || "icons/icon-192.png";
  try {
    await Promise.all([loadProfile(), loadProviderStatus()]);
    populateHomeSelectors();
    showScreen("home");
    maybeOfferImport();
  } catch (e) {
    toast("Could not load your account data");
  }
});

async function getIdToken() {
  return CURRENT_USER.getIdToken();
}
async function apiPost(path, body) {
  const idToken = await getIdToken();
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, idToken }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "request failed");
  return data;
}

/* ---------- profile (Firestore) ---------- */
async function loadProfile() {
  const ref = doc(db, "users", CURRENT_USER.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    PROFILE = snap.data();
  } else {
    PROFILE = JSON.parse(JSON.stringify(DEFAULT_PROFILE));
    await setDoc(ref, PROFILE);
  }
}
async function saveProfile() {
  await setDoc(doc(db, "users", CURRENT_USER.uid), PROFILE);
}

/* ---------- applications (Firestore) ---------- */
function appsCol() { return collection(db, "users", CURRENT_USER.uid, "applications"); }
async function dbAll() {
  const snap = await getDocs(appsCol());
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
async function dbFindByCompanyRole(key) {
  const all = await dbAll();
  return all.find(r => r.companyRole === key);
}
async function dbGet(id) {
  const snap = await getDoc(doc(db, "users", CURRENT_USER.uid, "applications", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
async function dbAdd(record) {
  await setDoc(doc(db, "users", CURRENT_USER.uid, "applications", record.id), record);
}
async function dbUpdate(id, patch) {
  await updateDoc(doc(db, "users", CURRENT_USER.uid, "applications", id), patch);
}
async function dbDelete(id) {
  await deleteDoc(doc(db, "users", CURRENT_USER.uid, "applications", id));
}

/* ---------- one-time best-effort import from the pre-login local version ---------- */
function openLegacyDB() {
  return new Promise(resolve => {
    const req = indexedDB.open("jobagent");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => {};
  });
}
async function readLegacyApplications() {
  const idb = await openLegacyDB();
  if (!idb || !idb.objectStoreNames.contains("applications")) return [];
  return new Promise(resolve => {
    try {
      const tx = idb.transaction("applications", "readonly");
      const req = tx.objectStore("applications").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
}
async function maybeOfferImport() {
  if (localStorage.getItem("jobagent.importDismissed.v1")) return;
  try {
    const legacy = await readLegacyApplications();
    if (!legacy.length) { localStorage.setItem("jobagent.importDismissed.v1", "1"); return; }
    const existing = await dbAll();
    if (existing.length) { localStorage.setItem("jobagent.importDismissed.v1", "1"); return; }
    const n = legacy.length;
    if (confirm(`Found ${n} previously-saved application${n > 1 ? "s" : ""} on this device. Import them into your account?`)) {
      for (const rec of legacy) {
        const id = rec.id || (Date.now() + "-" + Math.random().toString(36).slice(2, 8));
        await dbAdd({ ...rec, id });
      }
      toast(`Imported ${n} application${n > 1 ? "s" : ""}`);
    }
  } catch (e) {
    // best-effort only
  } finally {
    localStorage.setItem("jobagent.importDismissed.v1", "1");
  }
}

/* ---------- provider key management ---------- */
async function loadProviderStatus() {
  try {
    PROVIDER_STATUS = await apiPost("/api/save-provider-key", { action: "status" });
  } catch (e) {
    PROVIDER_STATUS = { anthropic: { configured: false }, openai: { configured: false }, gemini: { configured: false } };
  }
  renderProviderList();
}
function renderProviderList() {
  const box = document.getElementById("providerList");
  if (!box) return;
  box.innerHTML = "";
  Object.keys(PROVIDER_META).forEach(p => {
    const meta = PROVIDER_META[p];
    const status = PROVIDER_STATUS[p] || { configured: false };
    const row = document.createElement("div");
    row.className = "provider-row";
    if (status.configured) {
      row.innerHTML = `
        <div>
          <div class="provider-name">${meta.label} <span class="badge badge-configured">connected</span></div>
          <div class="provider-preview">${escapeHtml(status.preview || "")}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-remove="${p}">Remove</button>`;
    } else {
      row.innerHTML = `
        <div style="flex:1;">
          <div class="provider-name">${meta.label} <span class="badge badge-missing">not connected</span></div>
          <div class="provider-preview">${escapeHtml(meta.note)} <a class="link" href="${meta.keyUrl}" target="_blank" rel="noopener">Get a key →</a></div>
          <div class="field" style="margin-top:8px;"><input type="password" placeholder="Paste ${meta.label} key" data-keyinput="${p}"></div>
          <button class="btn btn-outline btn-sm" data-save="${p}">Save key</button>
        </div>`;
    }
    box.appendChild(row);
  });
  box.querySelectorAll("[data-save]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const p = btn.getAttribute("data-save");
      const input = box.querySelector(`[data-keyinput="${p}"]`);
      const key = input.value.trim();
      if (!key) return;
      btn.disabled = true;
      btn.textContent = "Validating…";
      try {
        await apiPost("/api/save-provider-key", { action: "save", provider: p, apiKey: key, model: MODEL_REGISTRY[p][0].id });
        input.value = "";
        toast(`${PROVIDER_META[p].label} connected`);
        await loadProviderStatus();
        populateHomeSelectors();
      } catch (e) {
        toast(e.message || "Could not save key");
        btn.disabled = false;
        btn.textContent = "Save key";
      }
    });
  });
  box.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const p = btn.getAttribute("data-remove");
      if (!confirm(`Remove your ${PROVIDER_META[p].label} key?`)) return;
      try {
        await apiPost("/api/save-provider-key", { action: "remove", provider: p });
        toast("Removed");
        await loadProviderStatus();
        populateHomeSelectors();
      } catch (e) {
        toast("Could not remove key");
      }
    });
  });
}

/* ---------- provider/model picker on home ---------- */
function configuredProviders() {
  return Object.keys(PROVIDER_META).filter(p => PROVIDER_STATUS[p] && PROVIDER_STATUS[p].configured);
}
function populateHomeSelectors() {
  const configured = configuredProviders();
  const provSel = document.getElementById("providerSelect");
  const modelSel = document.getElementById("modelSelect");
  if (!configured.length) {
    provSel.innerHTML = "";
    modelSel.innerHTML = "";
    return;
  }
  provSel.innerHTML = configured.map(p => `<option value="${p}">${PROVIDER_META[p].label}</option>`).join("");
  const preferred = PROFILE?.preferredProvider && configured.includes(PROFILE.preferredProvider) ? PROFILE.preferredProvider : configured[0];
  provSel.value = preferred;
  populateModelSelector();
  provSel.onchange = () => { populateModelSelector(); persistPreference(); };
  modelSel.onchange = persistPreference;
}
function populateModelSelector() {
  const p = document.getElementById("providerSelect").value;
  const modelSel = document.getElementById("modelSelect");
  const models = MODEL_REGISTRY[p] || [];
  modelSel.innerHTML = models.map(m => `<option value="${m.id}">${m.label}</option>`).join("");
  const savedModel = (PROFILE?.preferredProvider === p && PROFILE?.preferredModel) ? PROFILE.preferredModel : (PROVIDER_STATUS[p] && PROVIDER_STATUS[p].model);
  if (savedModel && models.some(m => m.id === savedModel)) modelSel.value = savedModel;
}
let prefSaveTimer;
function persistPreference() {
  clearTimeout(prefSaveTimer);
  prefSaveTimer = setTimeout(async () => {
    PROFILE.preferredProvider = document.getElementById("providerSelect").value;
    PROFILE.preferredModel = document.getElementById("modelSelect").value;
    try { await saveProfile(); } catch (e) {}
  }, 400);
}
function currentSelection() {
  const configured = configuredProviders();
  if (!configured.length) return null;
  const provSel = document.getElementById("providerSelect");
  const modelSel = document.getElementById("modelSelect");
  return { provider: provSel.value || configured[0], model: modelSel.value || MODEL_REGISTRY[configured[0]][0].id };
}

/* ---------- capture ---------- */
const btnCamera = document.getElementById("btnCamera");
const btnUpload = document.getElementById("btnUpload");
const fileCamera = document.getElementById("fileCamera");
const fileUpload = document.getElementById("fileUpload");
btnCamera.addEventListener("click", () => { if (!configuredProviders().length) { showScreen("noprovider"); return; } fileCamera.click(); });
btnUpload.addEventListener("click", () => { if (!configuredProviders().length) { showScreen("noprovider"); return; } fileUpload.click(); });
fileCamera.addEventListener("change", e => handleFile(e.target.files[0]));
fileUpload.addEventListener("change", e => handleFile(e.target.files[0]));

function handleFile(file) {
  if (!file) return;
  const sel = currentSelection();
  if (!sel) { showScreen("noprovider"); return; }
  SESSION.provider = sel.provider;
  SESSION.model = sel.model;

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1600;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      SESSION.imageB64 = dataUrl.split(",")[1];
      startExtraction();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function setProcessing(text) {
  document.getElementById("processingStatus").textContent = text;
  showScreen("processing");
}

async function startExtraction(roleHint) {
  setProcessing(roleHint ? "Reading that role…" : "Reading the post…");
  try {
    const jd = await apiPost("/api/job-extract", {
      image: SESSION.imageB64, mediaType: "image/jpeg", roleHint,
      provider: SESSION.provider, model: SESSION.model
    });

    if (jd.readable === false) {
      document.getElementById("unreadableReason").textContent = jd.unreadable_reason || "The image didn't look like a job posting, or was too cropped/blurry to extract.";
      showScreen("unreadable");
      return;
    }
    if (jd.multiple_roles && !roleHint) {
      const box = document.getElementById("roleChips");
      box.innerHTML = "";
      (jd.role_candidates || []).forEach(label => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = label;
        chip.addEventListener("click", () => startExtraction(label));
        box.appendChild(chip);
      });
      showScreen("multirole");
      return;
    }
    if (!jd.recruiter_email) {
      showScreen("noemail");
      return;
    }

    SESSION.jd = jd;
    await afterExtraction();
  } catch (err) {
    toast(err.message || "Something went wrong reading that image.");
    showScreen("home");
  }
}

async function afterExtraction() {
  const jd = SESSION.jd;
  const key = `${(jd.company || "").trim().toLowerCase()}|${(jd.role_title || "").trim().toLowerCase()}`;
  jd._companyRoleKey = key;
  const dup = await dbFindByCompanyRole(key);
  if (dup) {
    document.getElementById("duplicateInfo").innerHTML =
      `<strong>${escapeHtml(jd.company)} — ${escapeHtml(jd.role_title)}</strong><br>` +
      `<span style="color:var(--muted); font-size:13px;">Applied ${dup.date} · status: ${dup.status} · fit: ${dup.fitVerdict}</span>`;
    document.getElementById("btnDuplicateContinue").onclick = () => proceedPastDuplicate();
    showScreen("duplicate");
    return;
  }
  proceedPastDuplicate();
}

function proceedPastDuplicate() {
  const jd = SESSION.jd;
  if (jd.explicitly_requested_fields && jd.explicitly_requested_fields.length) {
    renderQuickQuestions(jd.explicitly_requested_fields);
    showScreen("quickq");
    return;
  }
  runGenerate();
}

function renderQuickQuestions(fields) {
  const box = document.getElementById("quickFields");
  box.innerHTML = "";
  const labelMap = { current_ctc: "Current CTC", expected_ctc: "Expected CTC", notice_period: "Notice period", availability: "Availability" };
  fields.forEach(f => {
    const div = document.createElement("div");
    div.className = "field";
    const label = labelMap[f] || f.replace(/_/g, " ");
    const existing = PROFILE.standingAnswers[f] || "";
    div.innerHTML = `<label>${escapeHtml(label)}</label><input data-qfield="${f}" value="${escapeHtml(existing)}">`;
    box.appendChild(div);
  });
}
document.getElementById("btnQuickContinue").addEventListener("click", async () => {
  document.querySelectorAll("[data-qfield]").forEach(input => {
    PROFILE.standingAnswers[input.getAttribute("data-qfield")] = input.value;
  });
  try { await saveProfile(); } catch (e) {}
  runGenerate();
});

async function runGenerate() {
  setProcessing("Checking fit…");
  const statuses = ["Checking fit…", "Tailoring the resume…", "Drafting the email…"];
  let i = 0;
  const rotate = setInterval(() => { i = (i + 1) % statuses.length; document.getElementById("processingStatus").textContent = statuses[i]; }, 1800);
  try {
    const gen = await apiPost("/api/job-generate", { jd: SESSION.jd, profile: PROFILE, provider: SESSION.provider, model: SESSION.model });
    clearInterval(rotate);
    SESSION.generation = gen;
    SESSION.mismatchOverridden = false;

    if (gen.fit.verdict === "mismatch") {
      renderFitScreen(gen.fit);
      showScreen("fit");
    } else {
      renderReview();
      await logCurrentApplication("drafted");
      showScreen("review");
    }
  } catch (err) {
    clearInterval(rotate);
    toast(err.message || "Something went wrong generating the application.");
    showScreen("home");
  }
}

function renderFitScreen(fit) {
  const banner = document.getElementById("fitBanner");
  banner.innerHTML = `
    <div class="verdict-banner verdict-mismatch">
      <div class="title">Doesn't look like a fit</div>
      <div>${escapeHtml(fit.reason || "")}</div>
      ${fit.gap_note ? `<div style="margin-top:6px; font-size:13px; color:var(--muted);">${escapeHtml(fit.gap_note)}</div>` : ""}
    </div>`;
}
document.getElementById("btnDiscardMismatch").addEventListener("click", async () => {
  await logCurrentApplication("skipped");
  SESSION = { imageB64: null, jd: null, generation: null, mismatchOverridden: false, provider: SESSION.provider, model: SESSION.model };
  showScreen("home");
});
document.getElementById("btnApplyAnyway").addEventListener("click", async () => {
  SESSION.mismatchOverridden = true;
  renderReview();
  await logCurrentApplication("drafted");
  showScreen("review");
});

/* ---------- review screen ---------- */
function renderReview() {
  const jd = SESSION.jd, gen = SESSION.generation;
  const banner = document.getElementById("reviewVerdictBanner");
  const v = gen.fit.verdict;
  const cls = v === "strong" ? "verdict-strong" : v === "partial" ? "verdict-partial" : "verdict-mismatch";
  const title = v === "strong" ? "Strong fit" : v === "partial" ? "Partial fit" : "Mismatch — applying anyway";
  banner.innerHTML = `
    <div class="verdict-banner ${cls}">
      <div class="title">${title}</div>
      <div>${escapeHtml(gen.fit.reason || "")}</div>
      ${gen.fit.gap_note ? `<div style="margin-top:6px; font-size:13px;">Gap: ${escapeHtml(gen.fit.gap_note)}</div>` : ""}
    </div>`;

  document.getElementById("emailTo").value = jd.recruiter_email || "";
  document.getElementById("emailSubject").value = gen.email.subject || "";
  document.getElementById("emailBody").value = gen.email.body || "";

  const r = gen.resume || {};
  let html = "";
  if (r.title_line) html += `<div style="font-weight:700; margin-bottom:6px;">${escapeHtml(r.title_line)}</div>`;
  if (r.summary) html += `<div style="margin-bottom:10px;">${escapeHtml(r.summary)}</div>`;
  if (r.skills && r.skills.length) html += `<div style="margin-bottom:6px;"><strong>Skills:</strong> ${escapeHtml(r.skills.slice(0, 10).join(", "))}${r.skills.length > 10 ? "…" : ""}</div>`;
  if (r.bullet_sections && r.bullet_sections.length) {
    r.bullet_sections.forEach(s => {
      html += `<div style="margin-top:8px; font-weight:600;">${escapeHtml(s.header)}</div><ul class="changed">`;
      (s.bullets || []).forEach(b => html += `<li>${escapeHtml(b)}</li>`);
      html += `</ul>`;
    });
  }
  document.getElementById("resumePreview").innerHTML = html || "<span class='sub'>No resume content generated.</span>";

  const wc = document.getElementById("whatChangedList");
  wc.innerHTML = "";
  (r.what_changed || []).forEach(c => {
    const li = document.createElement("li");
    li.textContent = c;
    wc.appendChild(li);
  });
  document.getElementById("whatChangedCard").style.display = (r.what_changed && r.what_changed.length) ? "block" : "none";
}

document.getElementById("btnCopyEmail").addEventListener("click", () => {
  navigator.clipboard.writeText(document.getElementById("emailBody").value).then(() => toast("Copied"));
});
document.getElementById("btnMailto").addEventListener("click", () => {
  const to = document.getElementById("emailTo").value;
  const subject = document.getElementById("emailSubject").value;
  const body = document.getElementById("emailBody").value;
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  toast("Resume downloads separately — attach it in your mail app");
  window.location.href = mailto;
});
document.getElementById("btnDownloadResume").addEventListener("click", async () => {
  const jd = SESSION.jd, gen = SESSION.generation;
  try {
    const idToken = await getIdToken();
    const r = await fetch("/api/job-resume-docx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idToken, resume: gen.resume, contact: PROFILE.identity,
        fileNameHint: `${jd.company || "resume"}-${jd.role_title || ""}`
      })
    });
    if (!r.ok) { toast("Couldn't build the resume file"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(jd.company || "resume").replace(/[^a-z0-9]+/gi, "-")}-resume.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast("Couldn't build the resume file");
  }
});
document.getElementById("btnMarkSent").addEventListener("click", async () => {
  if (SESSION.logId) {
    try { await dbUpdate(SESSION.logId, { status: "sent" }); } catch (e) {}
  }
  toast("Marked as sent");
  showScreen("home");
});

async function logCurrentApplication(status) {
  const jd = SESSION.jd, gen = SESSION.generation;
  const id = SESSION.logId || (Date.now() + "-" + Math.random().toString(36).slice(2, 8));
  SESSION.logId = id;
  const record = {
    id,
    company: jd.company || "",
    role: jd.role_title || "",
    companyRole: jd._companyRoleKey,
    recruiterEmail: jd.recruiter_email || "",
    date: new Date().toISOString().slice(0, 10),
    dateApplied: new Date().toISOString().slice(0, 10),
    fitVerdict: gen.fit.verdict + (SESSION.mismatchOverridden ? " (overridden)" : ""),
    status,
    email: gen.email,
    resume: gen.resume,
    provider: SESSION.provider,
    model: SESSION.model,
    followUps: []
  };
  await dbAdd(record);
}

/* ---------- log ---------- */
async function renderLog() {
  const list = document.getElementById("logList");
  list.innerHTML = "<div class='empty'>Loading…</div>";
  const items = await dbAll();
  if (!items.length) { list.innerHTML = "<div class='empty'>Nothing logged yet.</div>"; return; }
  list.innerHTML = "";
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "log-item";
    const badgeClass = item.fitVerdict.startsWith("strong") ? "badge-strong" : item.fitVerdict.startsWith("partial") ? "badge-partial" : "badge-mismatch";
    div.innerHTML = `
      <div><div class="lname">${escapeHtml(item.company)}</div><div class="lrole">${escapeHtml(item.role)}</div></div>
      <div class="lmeta"><span class="badge ${badgeClass}">${escapeHtml(item.fitVerdict)}</span><br><span class="badge badge-status" style="margin-top:4px;">${escapeHtml(item.status)}</span><br>${item.date}</div>`;
    div.addEventListener("click", () => openLogDetail(item.id));
    list.appendChild(div);
  });
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
}

async function openLogDetail(id) {
  const item = await dbGet(id);
  if (!item) return;
  document.getElementById("logDetailTitle").textContent = `${item.company} — ${item.role}`;
  const body = document.getElementById("logDetailBody");
  const followUps = item.followUps || [];
  body.innerHTML = `
    <div class="card">
      <div><strong>Status:</strong> ${escapeHtml(item.status)}</div>
      <div><strong>Fit:</strong> ${escapeHtml(item.fitVerdict)}</div>
      <div><strong>Recruiter:</strong> ${escapeHtml(item.recruiterEmail)}</div>
      <div><strong>Applied:</strong> ${item.date} (${daysSince(item.dateApplied || item.date)} days ago)</div>
    </div>
    <div class="card">
      <h2 style="margin-top:0;">Email</h2>
      <div style="font-weight:600; margin-bottom:6px;">${escapeHtml(item.email?.subject || "")}</div>
      <div style="white-space:pre-wrap; font-size:14px;">${escapeHtml(item.email?.body || "")}</div>
    </div>
    <div class="btn-row">
      <button class="btn btn-outline" id="btnLogMarkSent">Mark as sent</button>
      <button class="btn btn-ghost" id="btnLogDelete">Delete</button>
    </div>
    <div class="hr"></div>
    <button class="btn btn-primary" id="btnDraftFollowup">✉️ Draft follow-up email</button>
    <div id="followupList">
      ${followUps.map((f, idx) => `
        <div class="followup-item">
          <div style="font-size:12px; color:var(--muted); margin-bottom:4px;">Follow-up · ${f.date} · <span class="badge badge-status">${escapeHtml(f.status)}</span></div>
          <div style="font-weight:600; margin-bottom:4px;">${escapeHtml(f.subject)}</div>
          <div style="white-space:pre-wrap; font-size:14px; margin-bottom:8px;">${escapeHtml(f.body)}</div>
          <div class="btn-row">
            <button class="btn btn-outline btn-sm" data-fu-copy="${idx}">Copy</button>
            <button class="btn btn-primary btn-sm" data-fu-mailto="${idx}">Open in Mail App</button>
            ${f.status !== "sent" ? `<button class="btn btn-ghost btn-sm" data-fu-sent="${idx}">Mark sent</button>` : ""}
          </div>
        </div>`).join("")}
    </div>`;

  document.getElementById("btnLogMarkSent").addEventListener("click", async () => {
    await dbUpdate(id, { status: "sent" }); toast("Marked as sent"); openLogDetail(id);
  });
  document.getElementById("btnLogDelete").addEventListener("click", async () => {
    if (!confirm("Delete this application?")) return;
    await dbDelete(id);
    toast("Deleted"); showScreen("log"); renderLog();
  });
  document.getElementById("btnDraftFollowup").addEventListener("click", () => draftFollowup(id));
  body.querySelectorAll("[data-fu-copy]").forEach(btn => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(followUps[+btn.getAttribute("data-fu-copy")].body).then(() => toast("Copied"));
    });
  });
  body.querySelectorAll("[data-fu-mailto]").forEach(btn => {
    btn.addEventListener("click", () => {
      const f = followUps[+btn.getAttribute("data-fu-mailto")];
      window.location.href = `mailto:${encodeURIComponent(item.recruiterEmail)}?subject=${encodeURIComponent(f.subject)}&body=${encodeURIComponent(f.body)}`;
    });
  });
  body.querySelectorAll("[data-fu-sent]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = +btn.getAttribute("data-fu-sent");
      const updated = followUps.map((f, i) => i === idx ? { ...f, status: "sent" } : f);
      await dbUpdate(id, { followUps: updated });
      openLogDetail(id);
    });
  });

  showScreen("logdetail");
}

async function draftFollowup(appId) {
  const item = await dbGet(appId);
  const sel = currentSelection();
  if (!sel) { toast("Add an AI provider key first"); showScreen("profile"); return; }
  toast("Drafting follow-up…");
  try {
    const result = await apiPost("/api/job-followup", {
      application: item, profile: PROFILE, daysSinceApplied: daysSince(item.dateApplied || item.date),
      provider: sel.provider, model: sel.model
    });
    const followUp = { id: Date.now() + "-" + Math.random().toString(36).slice(2, 6), date: new Date().toISOString().slice(0, 10), subject: result.subject, body: result.body, status: "drafted" };
    const followUps = [...(item.followUps || []), followUp];
    await dbUpdate(appId, { followUps });
    toast("Follow-up drafted");
    openLogDetail(appId);
  } catch (e) {
    toast(e.message || "Could not draft follow-up");
  }
}

/* ---------- profile screen ---------- */
function fillProfileForm() {
  document.getElementById("pName").value = PROFILE.identity.name || "";
  document.getElementById("pLocation").value = PROFILE.identity.location || "";
  document.getElementById("pPhone").value = PROFILE.identity.phone || "";
  document.getElementById("pEmail").value = PROFILE.identity.email || "";
  document.getElementById("pLinkedin").value = PROFILE.identity.linkedin || "";
  document.getElementById("pNotice").value = PROFILE.standingAnswers.notice_period || "";
  document.getElementById("pCurrentCtc").value = PROFILE.standingAnswers.current_ctc || "";
  document.getElementById("pExpectedCtc").value = PROFILE.standingAnswers.expected_ctc || "";
  setRelo(PROFILE.standingAnswers.open_to_relocation === "yes");
  document.getElementById("pResumeJson").value = JSON.stringify(PROFILE.resume, null, 2);
  renderProviderList();
}
function setRelo(yes) {
  document.getElementById("pReloYes").classList.toggle("on", yes);
  document.getElementById("pReloNo").classList.toggle("on", !yes);
}
document.getElementById("pReloYes").addEventListener("click", () => setRelo(true));
document.getElementById("pReloNo").addEventListener("click", () => setRelo(false));
document.getElementById("btnSaveProfile").addEventListener("click", async () => {
  let resumeData;
  try {
    resumeData = JSON.parse(document.getElementById("pResumeJson").value);
  } catch (e) {
    toast("Resume JSON isn't valid — not saved");
    return;
  }
  PROFILE = {
    ...PROFILE,
    identity: {
      name: document.getElementById("pName").value,
      location: document.getElementById("pLocation").value,
      phone: document.getElementById("pPhone").value,
      email: document.getElementById("pEmail").value,
      linkedin: document.getElementById("pLinkedin").value
    },
    standingAnswers: {
      notice_period: document.getElementById("pNotice").value,
      current_ctc: document.getElementById("pCurrentCtc").value,
      expected_ctc: document.getElementById("pExpectedCtc").value,
      location: document.getElementById("pLocation").value,
      open_to_relocation: document.getElementById("pReloYes").classList.contains("on") ? "yes" : "no"
    },
    resume: resumeData
  };
  try {
    await saveProfile();
    toast("Profile saved");
  } catch (e) {
    toast("Could not save profile");
  }
});
document.getElementById("btnResetProfile").addEventListener("click", async () => {
  if (!confirm("Reset profile to the default seed data? This discards your edits.")) return;
  PROFILE = { ...JSON.parse(JSON.stringify(DEFAULT_PROFILE)), preferredProvider: PROFILE.preferredProvider, preferredModel: PROFILE.preferredModel };
  await saveProfile();
  fillProfileForm();
  toast("Reset to default");
});

/* ---------- service worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
