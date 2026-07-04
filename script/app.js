const STORAGE_KEY = "test-dashboard-data-v1";
const TOKEN_KEY = "gh-sync-token";
const CONFIG_KEY = "gh-sync-config";

const DEFAULT_CONFIG = {
  owner: "viet-grvt",
  repo: "test-case-dashboard",
  branch: "main",
  path: "data.json",
  syncMode: "auto",
};

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
let currentSha = null;
let currentSyncMode = DEFAULT_CONFIG.syncMode;

const sectionButtons = document.querySelectorAll(".menu-item");
const sections = document.querySelectorAll(".section");
const statsEl = document.getElementById("stats");
const rowsEl = document.getElementById("rows");
const runsListEl = document.getElementById("runsList");
const runsSummaryEl = document.getElementById("runsSummary");
const runsMetaEl = document.getElementById("runsMeta");
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
const updatedInput = document.getElementById("updated");
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
  tagsFilter.addEventListener("input", render);
  featureFilter.addEventListener("change", render);
  statusFilter.addEventListener("change", render);
  moduleFilter.addEventListener("change", render);
  sortFilter.addEventListener("change", render);
  clearFiltersBtn.addEventListener("click", () => {
    searchInput.value = "";
    tagsFilter.value = "";
    featureFilter.value = "all";
    statusFilter.value = "all";
    moduleFilter.value = "all";
    sortFilter.value = "updated-desc";
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
    path: pathCfgInput.value.trim() || "data.json",
    syncMode: selectedMode,
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  currentSyncMode = selectedMode;

  const token = tokenInput.value.trim();
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);

  settingsHint.textContent = "Reconnecting to repo...";
  currentSha = null;
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

  const normalizedPath = String(cfg.path || "data.json").replace(/^\/+/, "");
  const fallbackPaths = [normalizedPath];
  if (normalizedPath.startsWith("ds/")) {
    fallbackPaths.push(normalizedPath.replace(/^ds\//, ""));
  } else {
    fallbackPaths.push(`ds/${normalizedPath}`);
  }

  for (const path of fallbackPaths) {
    if (!path) continue;
    const url = `${contentsUrl(path)}?ref=${encodeURIComponent(cfg.branch)}`;
    const res = await githubRequest("GET", url);
    if (res.status === 404) {
      continue;
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.message || `GitHub API ${res.status}`);
    }
    const json = await res.json();
    currentSha = json.sha;
    if (path !== normalizedPath) {
      const updatedConfig = { ...cfg, path };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(updatedConfig));
    }
    return JSON.parse(fromBase64Utf8(json.content));
  }

  currentSha = null;
  return null;
}

async function commitData(message) {
  const token = getToken();
  if (!token) {
    setSyncStatus("local");
    return { skipped: true };
  }
  const content = toBase64Utf8(JSON.stringify(cases, null, 2) + "\n");

  const put = (sha) =>
    githubRequest("PUT", contentsUrl(), {
      message,
      content,
      branch: getConfig().branch,
      sha: sha || undefined,
    });

  setSyncStatus("saving");
  try {
    let res = await put(currentSha);
    if (res.status === 409 || res.status === 422) {
      await fetchFromRepo();
      res = await put(currentSha);
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      const msg = detail.message || `HTTP ${res.status}`;
      setSyncStatus("error", msg);
      return { ok: false, message: msg };
    }
    const json = await res.json();
    currentSha = json.content ? json.content.sha : currentSha;
    setSyncStatus("synced");
    return { ok: true };
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
          "data.json is not in the repo yet — save to create it",
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
  const candidates = ["./results.json", "./ds/results.json"];
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
    const res = await fetch("./data.json?t=" + Date.now(), {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Unable to load data.json");
    const data = await res.json();
    return data.map(normalizeCase);
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
  const features = [
    ...new Set(cases.map((item) => item.feature).filter(Boolean)),
  ].sort();
  featureFilter.innerHTML = [
    `<option value="all">All features</option>`,
    ...features.map(
      (feature) =>
        `<option value="${escapeHtml(feature)}">${escapeHtml(feature)}</option>`,
    ),
  ].join("");
  if (!features.includes(featureFilter.value)) {
    featureFilter.value = "all";
  }
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
    id: caseIdInput.value || `TC-${Date.now().toString().slice(-4)}`,
    name: nameInput.value.trim(),
    feature: featureInput.value.trim(),
    module: moduleInput.value.trim(),
    status: statusInput.value,
    tags: parseTags(tagsInput.value),
    updated: updatedInput.value,
    result: resultInput.value.trim(),
  };

  if (!payload.name || !payload.module || !payload.updated) return;

  const wasEditing = !!editingId;
  if (editingId) {
    cases = cases.map((item) => (item.id === editingId ? payload : item));
  } else {
    cases = [payload, ...cases];
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
  updatedInput.value = new Date().toISOString().slice(0, 10);
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
  updatedInput.value = item.updated;
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
      const tagQuery = tagsFilter.value.trim().toLowerCase();
      const matchesTag = !tagQuery || tagsText.toLowerCase().includes(tagQuery);
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
        case "updated-asc":
          return (a.updated || "").localeCompare(b.updated || "");
        case "name-asc":
          return (a.name || "").localeCompare(b.name || "");
        case "name-desc":
          return (b.name || "").localeCompare(a.name || "");
        case "updated-desc":
        default:
          return (b.updated || "").localeCompare(a.updated || "");
      }
    });

  renderStats();
  renderRows(filtered);
  renderRuns();
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
          ${web.featureList
            .map(
              (f) =>
                `<div class="feature-item"><span>${escapeHtml(f[0])}</span><strong>${f[1]}</strong></div>`,
            )
            .join("")}
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
          ${mobile.featureList
            .map(
              (f) =>
                `<div class="feature-item"><span>${escapeHtml(f[0])}</span><strong>${f[1]}</strong></div>`,
            )
            .join("")}
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
          <td>${escapeHtml(item.updated)}</td>
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
  const candidates = ["./runs.json", "./ds/runs.json"];
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
        }" title="${escapeHtml(String(s.date || s.id))} — ${escapeHtml(
          s.status,
        )}"></span>`,
    )
    .join("");
  return `<div class="trend-cells">${cells}</div>`;
}

function renderRuns() {
  if (!runsListEl) return;
  if (runsMetaEl) runsMetaEl.textContent = runs.length ? `${runs.length} run(s)` : "";
  if (!runs.length) {
    runsSummaryEl.innerHTML = "";
    runsListEl.innerHTML = `<div class="empty">No runs published yet.</div>`;
    return;
  }

  runsSummaryEl.innerHTML = `
    <div class="panel card">
      <div class="label">Pass rate trend</div>
      ${svgPassRateLine(runs)}
    </div>`;

  runsListEl.innerHTML = runs
    .map((run) => {
      const t = runTotals(run);
      const rate = passRate(t);
      const meta = [run.date, run.env, run.browser]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" · ");
      return `
        <div class="run-row">
          <div class="run-main">
            <div class="run-title">
              <strong>Run ${escapeHtml(String(run.id))}</strong>
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
  const meta = [run.date, run.env, run.browser]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
  const link = run.runUrl
    ? `<a class="result-link" href="${escapeHtml(run.runUrl)}" target="_blank" rel="noopener">Open CI run ↗</a>`
    : "";
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
  detailTitle.textContent = `Run ${run.id}`;
  detailBody.innerHTML = `
    <p class="muted" style="margin-top:0">${meta}${link ? " · " + link : ""}</p>
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
    .map((r) => ({ date: r.date, status: r.results[id], id: r.id }));
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
