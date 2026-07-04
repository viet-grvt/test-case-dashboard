const STORAGE_KEY = "test-dashboard-data-v1";
const TOKEN_KEY = "gh-sync-token";
const CONFIG_KEY = "gh-sync-config";

const DEFAULT_CONFIG = {
  owner: "viet-grvt",
  repo: "test-case-dashboard",
  branch: "main",
  path: "data/test-cases.json",
  syncMode: "auto",
};

// Test cases are split by module into two files under data/test-cases/.
// The WEB file holds everything that isn't MOBILE, so no case is ever dropped.
const CASE_FILES = [
  { module: "MOBILE", path: "data/test-cases/mobile.json" },
  { module: "WEB", path: "data/test-cases/web.json" },
];
function fileForCase(item) {
  return String(item.module || "").toUpperCase() === "MOBILE"
    ? "data/test-cases/mobile.json"
    : "data/test-cases/web.json";
}
// Serialize a module's cases exactly as they are written to its file.
function serializeCaseFile(subset) {
  return JSON.stringify(subset, null, 2) + "\n";
}
// Snapshot what each file currently holds, so commitData only PUTs files that
// actually changed (avoids GitHub "0 files changed" empty commits).
function snapshotBaseline() {
  for (const cf of CASE_FILES) {
    caseBaseline[cf.path] = serializeCaseFile(
      cases.filter((c) => fileForCase(c) === cf.path),
    );
  }
}

// Next sequential id for a module: W-### for web, M-### for mobile.
function nextCaseId(moduleVal) {
  const prefix = String(moduleVal || "").toUpperCase() === "MOBILE" ? "M" : "W";
  const re = new RegExp("^" + prefix + "-(\\d+)$", "i");
  let max = 0;
  cases.forEach((c) => {
    const m = re.exec(String(c.id || ""));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

const sampleData = [
  {
    id: "TC-101",
    name: "Login with valid credentials",
    module: "Auth",
    status: "Passed",
    tags: ["login", "auth"],
    updated: "2026-07-01",
    result: "User login succeeded and redirected to dashboard.",
  },
  {
    id: "TC-102",
    name: "Checkout with coupon",
    module: "Checkout",
    status: "Failed",
    tags: ["payment", "coupon"],
    updated: "2026-07-02",
    result: "Discount was not applied correctly.",
  },
  {
    id: "TC-103",
    name: "Profile avatar upload",
    module: "Profile",
    status: "Blocked",
    tags: ["upload", "profile"],
    updated: "2026-07-02",
    result: "Waiting for API availability.",
  },
  {
    id: "TC-104",
    name: "Password reset email",
    module: "Auth",
    status: "Pending",
    tags: ["password", "email"],
    updated: "2026-07-03",
    result: "Queued for execution.",
  },
];

let cases = [];
// Automated run outcomes, keyed by test-case id (TC-###). Loaded from
// results.json (written by CI) and kept SEPARATE from `cases` so manual
// edits + syncs to data.json never overwrite run results.
let runResults = {};
// Append-only run history (runs.json, written by CI). Powers the Runs page
// and the per-test-case trend chart.
let runs = [];
let editingId = null;
let caseShas = {}; // { "<path>": sha } for each split test-case file
let caseBaseline = {}; // { "<path>": serialized content } — repo state, to avoid empty commits
let currentSyncMode = DEFAULT_CONFIG.syncMode;

const sectionButtons = document.querySelectorAll(".menu-item");
const sections = document.querySelectorAll(".section");
const statsEl = document.getElementById("stats");
const rowsEl = document.getElementById("rows");
const runsListEl = document.getElementById("runsList");
const runsSummaryEl = document.getElementById("runsSummary");
const runsMetaEl = document.getElementById("runsMeta");
const runModuleFilter = document.getElementById("runModuleFilter");
const runEnvFilter = document.getElementById("runEnvFilter");
const runBrowserFilter = document.getElementById("runBrowserFilter");
const detailModal = document.getElementById("detailModal");
const detailBody = document.getElementById("detailBody");
const detailTitle = document.getElementById("detailTitle");
const detailCloseBtn = document.getElementById("detailCloseBtn");
const searchInput = document.getElementById("searchInput");
const tagsFilter = document.getElementById("tagsFilter");
const statusFilter = document.getElementById("statusFilter");
const featureFilter = document.getElementById("featureFilter");
const moduleFilter = document.getElementById("moduleFilter");
const sortFilter = document.getElementById("sortFilter");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const resetBtn = document.getElementById("resetBtn");
const toggleFormBtn = document.getElementById("toggleFormBtn");
const cancelBtn = document.getElementById("cancelBtn");
const caseModal = document.getElementById("caseModal");
const form = document.getElementById("caseForm");
const formTitle = document.getElementById("formTitle");
const caseIdInput = document.getElementById("caseId");
const nameInput = document.getElementById("name");
const moduleInput = document.getElementById("module");
const statusInput = document.getElementById("status");
const tagsInput = document.getElementById("tags");
const featureInput = document.getElementById("feature");
const resultInput = document.getElementById("result");

const syncStatusEl = document.getElementById("syncStatus");
const settingsBtn = document.getElementById("settingsBtn");
const syncPanel = document.getElementById("syncPanel");
const settingsForm = document.getElementById("settingsForm");
const tokenInput = document.getElementById("tokenInput");
const ownerCfgInput = document.getElementById("ownerInput");
const repoCfgInput = document.getElementById("repoInput");
const branchCfgInput = document.getElementById("branchInput");
const pathCfgInput = document.getElementById("pathInput");
const syncModeInputs = document.querySelectorAll('input[name="syncMode"]');
const syncNowBtn = document.getElementById("syncNowBtn");
const redeployBtn = document.getElementById("redeployBtn");
const clearTokenBtn = document.getElementById("clearTokenBtn");
const settingsHint = document.getElementById("settingsHint");

window.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  hydrateSettingsForm();
  await loadData();
  await loadRunResults();
  await loadRuns();
  render();
}

function bindEvents() {
  sectionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveSection(button.dataset.section);
    });
  });

  searchInput.addEventListener("input", render);
  tagsFilter.addEventListener("change", render);
  featureFilter.addEventListener("change", () => {
    populateTagFilter();
    render();
  });
  statusFilter.addEventListener("change", render);
  moduleFilter.addEventListener("change", () => {
    populateFeatureFilter();
    populateTagFilter();
    render();
  });
  sortFilter.addEventListener("change", render);
  clearFiltersBtn.addEventListener("click", () => {
    searchInput.value = "";
    tagsFilter.value = "all";
    featureFilter.value = "all";
    statusFilter.value = "all";
    moduleFilter.value = "all";
    sortFilter.value = "name-asc";
    populateFeatureFilter();
    populateTagFilter();
    render();
  });
  resetBtn.addEventListener("click", async () => {
    await loadData(true);
    await loadRunResults();
    await loadRuns();
    render();
    resetForm();
  });
  toggleFormBtn.addEventListener("click", () => {
    resetForm();
    openCaseModal();
  });
  cancelBtn.addEventListener("click", closeCaseModal);
  caseModal.addEventListener("click", (event) => {
    if (event.target === caseModal) closeCaseModal();
  });
  form.addEventListener("submit", handleSubmit);
  syncNowBtn.addEventListener("click", async () => {
    await manualSync();
  });

  settingsBtn.addEventListener("click", () => {
    syncPanel.hidden = !syncPanel.hidden;
  });
  settingsForm.addEventListener("submit", saveSettings);
  clearTokenBtn.addEventListener("click", clearToken);
  redeployBtn.addEventListener("click", redeploySite);
  detailCloseBtn.addEventListener("click", closeDetailModal);
  detailModal.addEventListener("click", (event) => {
    if (event.target === detailModal) closeDetailModal();
  });
  [runModuleFilter, runEnvFilter, runBrowserFilter].forEach((el) => {
    if (el) el.addEventListener("change", renderRuns);
  });
}

async function manualSync() {
  const token = getToken();
  if (!token) {
    settingsHint.textContent =
      "No token found. Enter a token to sync to GitHub.";
    return;
  }
  const message = `manual sync ${new Date().toISOString()}`;
  const result = await commitData(message);
  if (result.ok) {
    settingsHint.textContent = "Manual sync completed.";
  }
}

function setActiveSection(sectionId) {
  sections.forEach((section) => {
    section.classList.toggle("active", section.id === sectionId);
  });
  sectionButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.section === sectionId);
  });
}

async function redeploySite() {
  const token = getToken();
  const cfg = getConfig();
  if (!token) {
    settingsHint.textContent = "Need a token to trigger redeploy.";
    return;
  }
  if (!cfg.owner || !cfg.repo) {
    settingsHint.textContent = "Owner and repo are required to redeploy.";
    return;
  }

  setSyncStatus("saving", "Triggering redeploy...");
  try {
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/pages/builds`;
    const res = await githubRequest("POST", url);
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      const msg = detail.message || `HTTP ${res.status}`;
      setSyncStatus("error", msg);
      settingsHint.textContent = `Redeploy failed: ${msg}`;
      return;
    }
    setSyncStatus("synced", "Redeploy requested");
    settingsHint.textContent =
      "Redeploy request sent. GitHub Pages will rebuild soon.";
  } catch (err) {
    setSyncStatus("error", err.message);
    settingsHint.textContent = `Redeploy failed: ${err.message}`;
  }
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function getConfig() {
  const saved = localStorage.getItem(CONFIG_KEY);
  if (saved) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch (e) {
      return { ...DEFAULT_CONFIG };
    }
  }
  return { ...DEFAULT_CONFIG };
}

function hydrateSettingsForm() {
  const cfg = getConfig();
  tokenInput.value = getToken();
  ownerCfgInput.value = cfg.owner;
  repoCfgInput.value = cfg.repo;
  branchCfgInput.value = cfg.branch;
  pathCfgInput.value = cfg.path;
  currentSyncMode = cfg.syncMode || DEFAULT_CONFIG.syncMode;
  syncModeInputs.forEach((input) => {
    input.checked = input.value === currentSyncMode;
  });
}

async function saveSettings(event) {
  event.preventDefault();
  const selectedMode =
    Array.from(syncModeInputs).find((input) => input.checked)?.value || "auto";
  const cfg = {
    owner: ownerCfgInput.value.trim(),
    repo: repoCfgInput.value.trim(),
    branch: branchCfgInput.value.trim() || "main",
    path: pathCfgInput.value.trim() || "data/test-cases.json",
    syncMode: selectedMode,
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  currentSyncMode = selectedMode;

  const token = tokenInput.value.trim();
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);

  settingsHint.textContent = "Reconnecting to repo...";
  caseShas = {};
  await loadData();
  render();
  settingsHint.textContent = getToken()
    ? selectedMode === "auto"
      ? "Saved. Every change will sync automatically."
      : "Saved. Changes will wait until you click Sync now."
    : "Settings saved. No token yet — local-only mode.";
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  tokenInput.value = "";
  settingsHint.textContent = "Token removed from this browser.";
  setSyncStatus("local");
}

function setSyncStatus(state, detail) {
  const map = {
    synced: ["synced", "Synced with repo ✓"],
    saving: ["saving", "Saving…"],
    local: ["local", "Local only"],
    pending: ["pending", "Pending sync"],
    error: ["error", "Sync error ✗"],
  };
  const entry = map[state] || map.local;
  syncStatusEl.className = "sync-pill " + entry[0];
  syncStatusEl.textContent = detail ? `${entry[1]} — ${detail}` : entry[1];
  syncStatusEl.title = detail || "";
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64Utf8(b64) {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function contentsUrl(path) {
  const cfg = getConfig();
  const targetPath = path || cfg.path;
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${targetPath}`;
}

async function githubRequest(method, url, body) {
  const token = getToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function fetchFromRepo() {
  const cfg = getConfig();
  if (!cfg.owner || !cfg.repo) {
    return null;
  }

  const merged = [];
  let anyFound = false;
  caseShas = {};
  for (const cf of CASE_FILES) {
    const url = `${contentsUrl(cf.path)}?ref=${encodeURIComponent(cfg.branch)}`;
    const res = await githubRequest("GET", url);
    if (res.status === 404) {
      caseShas[cf.path] = null;
      continue;
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.message || `GitHub API ${res.status}`);
    }
    const json = await res.json();
    caseShas[cf.path] = json.sha;
    anyFound = true;
    const arr = JSON.parse(fromBase64Utf8(json.content));
    (Array.isArray(arr) ? arr : []).forEach((c) =>
      merged.push({ ...c, module: c.module || cf.module }),
    );
  }

  return anyFound ? merged : null;
}

async function commitData(message) {
  const token = getToken();
  if (!token) {
    setSyncStatus("local");
    return { skipped: true };
  }

  setSyncStatus("saving");
  try {
    // Route each case to its module file; only PUT files that actually changed
    // (so unchanged files don't create empty "0 files changed" commits).
    let changed = 0;
    for (const cf of CASE_FILES) {
      const subset = cases.filter((c) => fileForCase(c) === cf.path);
      const raw = serializeCaseFile(subset);
      if (raw === caseBaseline[cf.path]) continue;
      const content = toBase64Utf8(raw);
      const put = (sha) =>
        githubRequest("PUT", contentsUrl(cf.path), {
          message,
          content,
          branch: getConfig().branch,
          sha: sha || undefined,
        });

      let res = await put(caseShas[cf.path]);
      if (res.status === 409 || res.status === 422) {
        await fetchFromRepo();
        res = await put(caseShas[cf.path]);
      }
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        const msg = detail.message || `HTTP ${res.status}`;
        setSyncStatus("error", msg);
        return { ok: false, message: msg };
      }
      const json = await res.json();
      caseShas[cf.path] = json.content ? json.content.sha : caseShas[cf.path];
      caseBaseline[cf.path] = raw;
      changed++;
    }
    setSyncStatus("synced");
    return { ok: true, changed };
  } catch (err) {
    setSyncStatus("error", err.message);
    return { ok: false, message: err.message };
  }
}

async function loadData(forceRefresh = false) {
  const token = getToken();
  try {
    if (token) {
      const data = await fetchFromRepo();
      if (data) {
        cases = data.map(normalizeCase);
        setSyncStatus("synced");
      } else {
        cases = await fetchDeployedOrSample();
        setSyncStatus(
          "local",
          "test-case files are not in the repo yet — save to create them",
        );
      }
    } else {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!forceRefresh && saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          cases = parsed.map(normalizeCase);
        } else {
          cases = await fetchDeployedOrSample();
        }
      } else {
        cases = await fetchDeployedOrSample();
      }
      setSyncStatus("local");
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  } catch (error) {
    console.error("Load error:", error);
    const saved = localStorage.getItem(STORAGE_KEY);
    cases = saved
      ? JSON.parse(saved).map(normalizeCase)
      : sampleData.map((item) => normalizeCase(item));
    setSyncStatus(token ? "error" : "local", error.message);
  }
  populateModuleFilter();
  populateFeatureFilter();
  populateTagFilter();
  snapshotBaseline();
}

function normalizeCase(item) {
  const normalized = { ...item };
  if (normalized.owner !== undefined) {
    normalized.tags = normalized.tags || [];
    delete normalized.owner;
  }
  if (!Array.isArray(normalized.tags)) {
    normalized.tags = parseTags(String(normalized.tags || ""));
  }
  normalized.feature = String(normalized.feature || "").trim();
  return normalized;
}

async function loadRunResults() {
  // results.json is served publicly by GitHub Pages (no token needed).
  // Shape: { updatedAt, results: { "TC-105": { status, date, env, browser, runUrl } } }
  const candidates = ["./data/results.json", "./results.json"];
  for (const url of candidates) {
    try {
      const res = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      runResults = (data && data.results) || {};
      return;
    } catch (e) {
      // try next candidate
    }
  }
  runResults = {};
}

async function fetchDeployedOrSample() {
  try {
    const arrays = await Promise.all(
      CASE_FILES.map(async (cf) => {
        const res = await fetch(`./${cf.path}?t=` + Date.now(), {
          cache: "no-store",
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (Array.isArray(data) ? data : []).map((c) =>
          normalizeCase({ ...c, module: c.module || cf.module }),
        );
      }),
    );
    const merged = arrays.flat();
    if (!merged.length) throw new Error("no test-case files found");
    return merged;
  } catch (e) {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved
      ? JSON.parse(saved).map(normalizeCase)
      : sampleData.map((i) => normalizeCase(i));
  }
}

function populateModuleFilter() {
  const modules = [
    ...new Set(cases.map((item) => item.module).filter(Boolean)),
  ].sort();
  moduleFilter.innerHTML = [
    `<option value="all">All modules</option>`,
    ...modules.map(
      (module) =>
        `<option value="${escapeHtml(module)}">${escapeHtml(module)}</option>`,
    ),
  ].join("");
  if (!modules.includes(moduleFilter.value)) {
    moduleFilter.value = "all";
  }
}

function populateFeatureFilter() {
  // Scope the feature options to the selected module (e.g. MOBILE → only
  // mobile features), so picking a module narrows the feature dropdown.
  const mod = moduleFilter.value;
  const scoped = cases.filter((c) => mod === "all" || c.module === mod);
  const features = [
    ...new Set(scoped.map((item) => item.feature).filter(Boolean)),
  ].sort();
  const current = featureFilter.value;
  featureFilter.innerHTML = [
    `<option value="all">All features</option>`,
    ...features.map(
      (feature) =>
        `<option value="${escapeHtml(feature)}">${escapeHtml(feature)}</option>`,
    ),
  ].join("");
  featureFilter.value = features.includes(current) ? current : "all";
}

function populateTagFilter() {
  // Tag options cascade from the selected module + feature.
  const mod = moduleFilter.value;
  const feat = featureFilter.value;
  const scoped = cases.filter(
    (c) =>
      (mod === "all" || c.module === mod) &&
      (feat === "all" || c.feature === feat),
  );
  const tags = [
    ...new Set(scoped.flatMap((c) => c.tags || []).map(String).filter(Boolean)),
  ].sort();
  const current = tagsFilter.value;
  tagsFilter.innerHTML = [
    `<option value="all">All tags</option>`,
    ...tags.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`),
  ].join("");
  tagsFilter.value = tags.includes(current) ? current : "all";
}

function parseTags(value) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function handleSubmit(event) {
  event.preventDefault();
  const payload = {
    id: caseIdInput.value || nextCaseId(moduleInput.value),
    name: nameInput.value.trim(),
    feature: featureInput.value.trim(),
    module: moduleInput.value.trim(),
    status: statusInput.value,
    tags: parseTags(tagsInput.value),
    result: resultInput.value.trim(),
  };

  if (!payload.name || !payload.module) return;

  const wasEditing = !!editingId;
  if (editingId) {
    cases = cases.map((item) => (item.id === editingId ? payload : item));
  } else {
    cases = [...cases, payload]; // append new case at the end of its file
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  closeCaseModal();
  resetForm();
  populateModuleFilter();
  render();

  if (currentSyncMode === "auto") {
    await commitData(
      `dashboard: ${wasEditing ? "update" : "add"} ${payload.id}`,
    );
  } else {
    setSyncStatus("pending", "Changes saved locally. Click Sync now to push.");
  }
}

function openCaseModal() {
  caseModal.hidden = false;
  caseModal.classList.add("show");
  nameInput.focus();
}

function closeCaseModal() {
  caseModal.classList.remove("show");
  caseModal.hidden = true;
}

function resetForm() {
  form.reset();
  editingId = null;
  caseIdInput.value = "";
  tagsInput.value = "";
  featureInput.value = "";
  formTitle.textContent = "Create test case";
  statusInput.value = "Todo";
}

function editCase(id) {
  const item = cases.find((entry) => entry.id === id);
  if (!item) return;
  editingId = id;
  caseIdInput.value = item.id;
  nameInput.value = item.name;
  featureInput.value = item.feature || "";
  moduleInput.value = item.module;
  statusInput.value = item.status;
  tagsInput.value = item.tags ? item.tags.join(", ") : "";
  resultInput.value = item.result;
  formTitle.textContent = "Edit test case";
  openCaseModal();
}

async function deleteCase(id) {
  const target = cases.find((item) => item.id === id);
  if (!target) return;
  const confirmed = window.confirm(`Delete test case ${target.id}?`);
  if (!confirmed) return;

  cases = cases.filter((item) => item.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  populateModuleFilter();
  render();

  if (currentSyncMode === "auto") {
    await commitData(`dashboard: delete ${target.id}`);
  } else {
    setSyncStatus("pending", "Changes saved locally. Click Sync now to push.");
  }
}

function render() {
  const query = searchInput.value.toLowerCase();
  const selectedFeature = featureFilter.value;
  const selectedStatus = statusFilter.value;
  const selectedModule = moduleFilter.value;
  const filtered = cases
    .filter((item) => {
      const tagsText = (item.tags || []).join(" ");
      const run = runResults[item.id];
      const runText = run
        ? [run.status, run.env, run.browser].filter(Boolean).join(" ")
        : "";
      const matchesQuery = [
        item.name,
        item.module,
        item.feature,
        item.result,
        runText,
        tagsText,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      );
      const selectedTag = tagsFilter.value;
      const matchesTag =
        selectedTag === "all" ||
        (item.tags || []).some(
          (t) => String(t).toLowerCase() === selectedTag.toLowerCase(),
        );
      const matchesStatus =
        selectedStatus === "all" || item.status === selectedStatus;
      const matchesModule =
        selectedModule === "all" || item.module === selectedModule;
      const matchesFeature =
        selectedFeature === "all" || item.feature === selectedFeature;
      return (
        matchesQuery &&
        matchesTag &&
        matchesStatus &&
        matchesModule &&
        matchesFeature
      );
    })
    .sort((a, b) => {
      switch (sortFilter.value) {
        case "name-desc":
          return (b.name || "").localeCompare(a.name || "");
        case "name-asc":
        default:
          return (a.name || "").localeCompare(b.name || "");
      }
    });

  renderStats();
  renderRows(filtered);
  renderRuns();
}

function attrJs(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;");
}

// Clickable feature rows on the dashboard → jump to Test cases pre-filtered.
function featureListHtml(featureList, moduleName) {
  return featureList
    .map(
      (f) =>
        `<div class="feature-item clickable" role="button" tabindex="0" onclick="openFeature('${moduleName}','${attrJs(
          f[0],
        )}')"><span>${escapeHtml(f[0])}</span><strong>${f[1]}</strong></div>`,
    )
    .join("");
}

function openFeature(moduleName, feature) {
  moduleFilter.value = moduleName;
  populateFeatureFilter();
  featureFilter.value = feature;
  populateTagFilter();
  tagsFilter.value = "all";
  statusFilter.value = "all";
  searchInput.value = "";
  setActiveSection("casesSection");
  render();
}

function renderStats() {
  // overall totals
  const totals = {
    Todo: cases.filter((item) => item.status === "Todo").length,
    "In Process": cases.filter((item) => item.status === "In Process").length,
    "In Review": cases.filter((item) => item.status === "In Review").length,
    Done: cases.filter((item) => item.status === "Done").length,
  };

  // helper to compute module + feature breakdown
  function moduleOverview(moduleName) {
    const moduleItems = cases.filter((item) => item.module === moduleName);
    const total = moduleItems.length;
    const featureCounts = moduleItems.reduce((acc, it) => {
      const f = String(it.feature || "").trim() || "(no feature)";
      acc[f] = (acc[f] || 0) + 1;
      return acc;
    }, {});
    const statusCounts = moduleItems.reduce((acc, it) => {
      const s = String(it.status || "Todo");
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const featureList = Object.entries(featureCounts).sort(
      (a, b) => b[1] - a[1],
    );
    return { total, featureList, statusCounts };
  }

  const web = moduleOverview("WEB");
  const mobile = moduleOverview("MOBILE");

  const statusRow = (label, value) =>
    `<div class="status-row"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;

  const moduleStatusHtml = (statusCounts) =>
    ["Todo", "In Process", "In Review", "Done"]
      .map((status) => statusRow(status, statusCounts[status] || 0))
      .join("");

  statsEl.innerHTML = `
    <div class="three-columns">
      <div class="panel card">
        <div class="label">Total</div>
        <div class="value" style="color:var(--accent);">${cases.length}</div>
        <div class="subtext">All test cases</div>
        <div class="status-list">
          ${statusRow("Todo", totals.Todo)}
          ${statusRow("In Process", totals["In Process"])}
          ${statusRow("In Review", totals["In Review"])}
          ${statusRow("Done", totals.Done)}
        </div>
      </div>

      <div class="panel card">
        <div class="label">WEB</div>
        <div class="value" style="color:var(--accent);">${web.total}</div>
        <div class="subtext">Status breakdown</div>
        <div class="status-list">
          ${moduleStatusHtml(web.statusCounts)}
        </div>
        <div class="subtext">Top features</div>
        <div class="feature-list">
          ${featureListHtml(web.featureList, "WEB")}
        </div>
      </div>

      <div class="panel card">
        <div class="label">MOBILE</div>
        <div class="value" style="color:var(--accent-soft);">${mobile.total}</div>
        <div class="subtext">Status breakdown</div>
        <div class="status-list">
          ${moduleStatusHtml(mobile.statusCounts)}
        </div>
        <div class="subtext">Top features</div>
        <div class="feature-list">
          ${featureListHtml(mobile.featureList, "MOBILE")}
        </div>
      </div>
    </div>
  `;
}

function resultCell(item) {
  // Prefer the automated run outcome (results.json) over the manual note.
  const run = runResults[item.id];
  if (run && run.status) {
    const clsMap = {
      passed: "pass",
      failed: "fail",
      flaky: "flaky",
      skipped: "skipped",
    };
    const cls = clsMap[run.status] || "pending";
    const badge = `<span class="pill ${cls}">${escapeHtml(run.status)}</span>`;
    const metaParts = [run.date, run.env, run.browser]
      .filter(Boolean)
      .map(escapeHtml)
      .join(" · ");
    const link = run.runUrl
      ? `<a class="result-link" href="${escapeHtml(run.runUrl)}" target="_blank" rel="noopener">run ↗</a>`
      : "";
    const meta = [metaParts, link].filter(Boolean).join(" ");
    return `<div class="table-result">${badge}${
      meta ? `<div class="result-meta">${meta}</div>` : ""
    }</div>`;
  }
  return `<div class="table-result">${escapeHtml(item.result || "—")}</div>`;
}

function renderRows(items) {
  if (!items.length) {
    rowsEl.innerHTML =
      '<tr><td colspan="6" class="empty">No matching test cases.</td></tr>';
    return;
  }

  rowsEl.innerHTML = items
    .map((item) => {
      const tagsHtml = (item.tags || [])
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join("");
      const statusClass = String(item.status || "")
        .toLowerCase()
        .replace(/\s+/g, "-");
      return `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
            <div class="muted">${escapeHtml(item.module)}</div>
          </td>
          <td>${escapeHtml(item.feature || "—")}</td>
          <td><span class="pill ${statusClass}">${escapeHtml(item.status)}</span></td>
          <td><div class="tags">${tagsHtml}</div></td>
          <td>${resultCell(item)}</td>
          <td>
            <div class="action-group">
              <button class="link-btn" type="button" onclick="openCaseTrend('${item.id}')">Trend</button>
              <button class="link-btn" type="button" onclick="editCase('${item.id}')">Edit</button>
              <button class="link-btn" type="button" onclick="deleteCase('${item.id}')">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------------ *
 * Runs page + charts (inline SVG, no external libraries)
 * ------------------------------------------------------------------ */

const RESULT_COLORS = {
  passed: "#16a34a",
  failed: "#dc2626",
  flaky: "#ca8a04",
  skipped: "#9ca3af",
};

async function loadRuns() {
  // runs.json is the append-only history written by CI (see README).
  const candidates = ["./data/runs.json", "./runs.json"];
  for (const url of candidates) {
    try {
      const res = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      runs = Array.isArray(data && data.runs) ? data.runs : [];
      return;
    } catch (e) {
      // try next candidate
    }
  }
  runs = [];
}

function caseName(id) {
  const c = cases.find((x) => x.id === id);
  return c ? c.name : id;
}

// Full local date-time (YYYY-MM-DD HH:MM:SS) from a run's ISO `at` timestamp,
// so multiple runs on the same day are distinguishable. Falls back to `date`.
function fmtDateTime(iso, fallback) {
  if (!iso) return fallback || "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return fallback || String(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function runTotals(run) {
  return run.totals || { passed: 0, failed: 0, flaky: 0, skipped: 0 };
}

function passRate(totals) {
  const denom =
    (totals.passed || 0) + (totals.failed || 0) + (totals.flaky || 0);
  if (!denom) return null;
  return Math.round(((totals.passed || 0) / denom) * 100);
}

// Horizontal stacked bar of a run's status breakdown.
function svgStackedBar(totals, width, height) {
  const w = width || 220;
  const h = height || 12;
  const order = ["passed", "failed", "flaky", "skipped"];
  const total = order.reduce((s, k) => s + (totals[k] || 0), 0);
  if (!total) {
    return `<svg width="${w}" height="${h}" class="stacked-bar"><rect width="${w}" height="${h}" rx="6" fill="#e5e7eb"/></svg>`;
  }
  let x = 0;
  const segs = order
    .map((k) => {
      const val = totals[k] || 0;
      if (!val) return "";
      const segW = (val / total) * w;
      const rect = `<rect x="${x.toFixed(2)}" y="0" width="${segW.toFixed(
        2,
      )}" height="${h}" fill="${RESULT_COLORS[k]}"><title>${k}: ${val}</title></rect>`;
      x += segW;
      return rect;
    })
    .join("");
  return `<svg width="${w}" height="${h}" class="stacked-bar" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${segs}</svg>`;
}

// Pass-rate line across runs (oldest -> newest).
function svgPassRateLine(runList, width, height) {
  const w = width || 640;
  const h = height || 120;
  const pad = 26;
  const chrono = [...runList].reverse(); // oldest first
  const pts = chrono
    .map((r, i) => ({ i, rate: passRate(runTotals(r)), run: r }))
    .filter((p) => p.rate !== null);
  if (!pts.length) return `<div class="muted">No pass-rate data yet.</div>`;
  const n = pts.length;
  const xFor = (i) => (n === 1 ? w / 2 : pad + (i / (n - 1)) * (w - 2 * pad));
  const yFor = (rate) => pad + (1 - rate / 100) * (h - 2 * pad);
  const line = pts
    .map(
      (p, idx) =>
        `${idx === 0 ? "M" : "L"}${xFor(p.i).toFixed(1)},${yFor(p.rate).toFixed(1)}`,
    )
    .join(" ");
  const dots = pts
    .map(
      (p) =>
        `<circle cx="${xFor(p.i).toFixed(1)}" cy="${yFor(p.rate).toFixed(
          1,
        )}" r="3.5" fill="#2563eb"><title>${escapeHtml(
          p.run.date || String(p.run.id),
        )}: ${p.rate}%</title></circle>`,
    )
    .join("");
  const grid = [0, 50, 100]
    .map(
      (v) =>
        `<line x1="${pad}" y1="${yFor(v).toFixed(1)}" x2="${w - pad}" y2="${yFor(
          v,
        ).toFixed(1)}" stroke="#e5e7eb"/><text x="2" y="${(yFor(v) + 3).toFixed(
          1,
        )}" font-size="10" fill="#94a3b8">${v}%</text>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="line-chart" preserveAspectRatio="xMidYMid meet">${grid}<path d="${line}" fill="none" stroke="#2563eb" stroke-width="2"/>${dots}</svg>`;
}

// Timeline of one test case's status across runs (oldest -> newest).
function svgTrendCells(series) {
  if (!series.length) {
    return `<div class="muted">No run history for this test case.</div>`;
  }
  const cells = series
    .map(
      (s) =>
        `<span class="trend-cell" style="background:${
          RESULT_COLORS[s.status] || "#e5e7eb"
        }" title="${escapeHtml(fmtDateTime(s.at, s.date) || String(s.id))} — ${escapeHtml(
          s.status,
        )}"></span>`,
    )
    .join("");
  return `<div class="trend-cells">${cells}</div>`;
}

function populateRunFilters() {
  const fill = (el, values, allLabel) => {
    if (!el) return;
    const current = el.value;
    const opts = [...new Set(values.filter(Boolean))].sort();
    el.innerHTML =
      `<option value="all">${allLabel}</option>` +
      opts
        .map(
          (v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`,
        )
        .join("");
    el.value = opts.includes(current) ? current : "all";
  };
  fill(runModuleFilter, runs.map((r) => r.module), "All modules");
  fill(runEnvFilter, runs.map((r) => r.env), "All environments");
  fill(runBrowserFilter, runs.map((r) => r.browser), "All browsers");
}

function renderRuns() {
  if (!runsListEl) return;
  populateRunFilters();
  const mod = runModuleFilter ? runModuleFilter.value : "all";
  const envF = runEnvFilter ? runEnvFilter.value : "all";
  const brF = runBrowserFilter ? runBrowserFilter.value : "all";
  const filtered = runs.filter(
    (r) =>
      (mod === "all" || r.module === mod) &&
      (envF === "all" || r.env === envF) &&
      (brF === "all" || r.browser === brF),
  );
  if (runsMetaEl) {
    runsMetaEl.textContent = filtered.length ? `${filtered.length} run(s)` : "";
  }
  if (!runs.length) {
    runsSummaryEl.innerHTML = "";
    runsListEl.innerHTML = `<div class="empty">No runs published yet.</div>`;
    return;
  }
  if (!filtered.length) {
    runsSummaryEl.innerHTML = "";
    runsListEl.innerHTML = `<div class="empty">No runs match the current filters.</div>`;
    return;
  }

  runsSummaryEl.innerHTML = `
    <div class="panel card">
      <div class="label">Pass rate trend</div>
      ${svgPassRateLine(filtered)}
    </div>`;

  runsListEl.innerHTML = filtered
    .map((run) => {
      const t = runTotals(run);
      const rate = passRate(t);
      const title = run.name
        ? escapeHtml(run.name)
        : `Run ${escapeHtml(String(run.id))}`;
      const metaParts = run.name ? ["#" + String(run.id)] : [];
      metaParts.push(fmtDateTime(run.at, run.date), run.module, run.env, run.browser);
      const meta = metaParts.filter(Boolean).map(escapeHtml).join(" · ");
      return `
        <div class="run-row">
          <div class="run-main">
            <div class="run-title">
              <strong>${title}</strong>
              <span class="muted">${meta}</span>
            </div>
            ${svgStackedBar(t, 240, 12)}
          </div>
          <div class="run-counts">
            <span class="count pass" title="passed">${t.passed || 0}</span>
            <span class="count fail" title="failed">${t.failed || 0}</span>
            <span class="count flaky" title="flaky">${t.flaky || 0}</span>
            <span class="count skipped" title="skipped">${t.skipped || 0}</span>
            <span class="run-rate">${rate === null ? "—" : rate + "%"}</span>
          </div>
          <button class="link-btn" type="button" onclick="openRunDetail('${escapeHtml(
            String(run.id),
          )}')">Details</button>
          ${
            run.reportUrl
              ? `<a class="link-btn" href="${escapeHtml(
                  run.reportUrl,
                )}" target="_blank" rel="noopener">Report ↗</a>`
              : ""
          }
        </div>`;
    })
    .join("");
}

function openRunDetail(id) {
  const run = runs.find((r) => String(r.id) === String(id));
  if (!run) return;
  const t = runTotals(run);
  const results = run.results || {};
  const legend = ["passed", "failed", "flaky", "skipped"]
    .map(
      (k) =>
        `<span class="legend-item"><span class="dot" style="background:${RESULT_COLORS[k]}"></span>${k} <strong>${t[k] || 0}</strong></span>`,
    )
    .join("");
  const metaParts = run.name ? ["#" + String(run.id)] : [];
  metaParts.push(fmtDateTime(run.at, run.date), run.module, run.env, run.browser);
  const meta = metaParts.filter(Boolean).map(escapeHtml).join(" · ");
  const links = [
    run.runUrl
      ? `<a class="result-link" href="${escapeHtml(run.runUrl)}" target="_blank" rel="noopener">Open CI run ↗</a>`
      : "",
    run.reportUrl
      ? `<a class="result-link" href="${escapeHtml(run.reportUrl)}" target="_blank" rel="noopener">Allure report ↗</a>`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const listFor = (want) =>
    Object.keys(results)
      .filter((tc) => results[tc] === want)
      .map(
        (tc) =>
          `<li><span class="tc-id">${escapeHtml(tc)}</span> ${escapeHtml(caseName(tc))}</li>`,
      )
      .join("");
  const failedList = listFor("failed");
  const flakyList = listFor("flaky");
  detailTitle.textContent = run.name || `Run ${run.id}`;
  detailBody.innerHTML = `
    <p class="muted" style="margin-top:0">${meta}${links ? " · " + links : ""}</p>
    ${svgStackedBar(t, 560, 16)}
    <div class="legend">${legend}</div>
    ${failedList ? `<h4>Failed (${t.failed || 0})</h4><ul class="tc-list">${failedList}</ul>` : ""}
    ${flakyList ? `<h4>Flaky (${t.flaky || 0})</h4><ul class="tc-list">${flakyList}</ul>` : ""}
    ${!failedList && !flakyList ? `<p class="muted">All tracked tests passed 🎉</p>` : ""}
  `;
  openDetailModal();
}

function openCaseTrend(id) {
  const name = caseName(id);
  const series = [...runs]
    .reverse() // oldest -> newest
    .filter((r) => r.results && r.results[id])
    .map((r) => ({ date: r.date, at: r.at, status: r.results[id], id: r.id }));
  const n = series.length;
  const passes = series.filter((s) => s.status === "passed").length;
  const fails = series.filter((s) => s.status === "failed").length;
  const flakes = series.filter((s) => s.status === "flaky").length;
  const rate = n ? Math.round((passes / n) * 100) : null;
  detailTitle.textContent = `${id} · trend`;
  detailBody.innerHTML = `
    <p style="margin-top:0"><strong>${escapeHtml(name)}</strong></p>
    ${
      n
        ? `<div class="trend-summary">
             <span>Runs: <strong>${n}</strong></span>
             <span class="count pass">${passes} passed</span>
             <span class="count fail">${fails} failed</span>
             <span class="count flaky">${flakes} flaky</span>
             <span class="run-rate">${rate}% pass</span>
           </div>
           <div class="muted" style="margin:10px 0 4px">Oldest → newest</div>
           ${svgTrendCells(series)}`
        : `<p class="muted">No run history for this test case yet. Tag its automated test with <code>@${escapeHtml(
            id,
          )}</code> to start collecting results.</p>`
    }
  `;
  openDetailModal();
}

function openDetailModal() {
  detailModal.hidden = false;
  detailModal.classList.add("show");
}

function closeDetailModal() {
  detailModal.classList.remove("show");
  detailModal.hidden = true;
}

window.editCase = editCase;
window.deleteCase = deleteCase;
window.openRunDetail = openRunDetail;
window.openCaseTrend = openCaseTrend;
window.openFeature = openFeature;
