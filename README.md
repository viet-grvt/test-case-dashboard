# Test Case Dashboard

A static dashboard for tracking test case results. It runs on GitHub Pages with
no server, and can commit changes back to `data/test-cases/*.json` in this repo through the
GitHub API.

## How it works

- The UI is plain HTML, CSS, and JavaScript.
- Data is read from `data/test-cases/*.json`.
- Edits and deletes are applied instantly in the browser and, when a GitHub
  token is configured, committed back to `data/test-cases/*.json` in the repo. GitHub Pages
  then redeploys and every visitor sees the update.
- Without a token the dashboard is **local-only**: changes stay in this
  browser's `localStorage` and are not shared.

## Data files

All JSON lives in the `data/` folder:

| File | Owner | Purpose |
|------|-------|---------|
| `data/test-cases/web.json` | edited by hand / dashboard UI | WEB test cases |
| `data/test-cases/mobile.json` | edited by hand / dashboard UI | MOBILE test cases |
| `data/results.json` | written by CI | latest run outcome per test case (the Result column) |
| `data/runs.json` | written by CI | run history (the Runs page + charts) |

Test cases are split by module into two files so each platform is easy to manage.
The dashboard loads and merges both; when you edit in the UI and sync, each case
is written back to the file matching its `module` (anything not `MOBILE` → web.json).

### Adding a test case directly in the JSON

Ids are per-platform and sequential ascending:
- **WEB** → `data/test-cases/web.json`, ids `W-###`
- **MOBILE** → `data/test-cases/mobile.json`, ids `M-###`

Append an object to the right file, using the next number after that file's
current maximum. Minimal shape:

```json
{ "id": "W-210", "name": "...", "feature": "E2E", "module": "WEB",
  "status": "Todo", "tags": ["regression"], "updated": "2026-07-04", "result": "" }
```

To auto-report results, tag the matching automated test with the same id, e.g.
`@W-210`. (The **+ Add test case** button also generates the next id for you.)

## Why changes used to revert

The old version re-merged `data/test-cases/*.json` over `localStorage` on every reload, so
`data/test-cases/*.json` always won — edits were overwritten and deleted rows reappeared.
Now `data/test-cases/*.json` (read live via the GitHub API when a token is set) is the single
source of truth, and mutations are committed back to it.

## Enabling repo sync

1. Create a **fine-grained Personal Access Token**:
   GitHub → Settings → Developer settings → Fine-grained tokens.
   - Repository access: **Only select repositories** → this repo.
   - Permissions: **Contents → Read and write**.
   - Set a short expiration.
2. Open the dashboard, click **⚙ Sync settings**.
3. Paste the token, confirm Owner / Repo / Branch, then **Lưu & kết nối**.
   Defaults: `viet-grvt` / `test-case-dashboard` / `main`. (The case files are
   fixed at `data/test-cases/web.json` + `mobile.json`; the Path field is unused.)

The status pill shows `Synced with repo ✓`, `Saving…`, `Local only`, or
`Sync error ✗`.

## Security

- The token is stored in this browser's `localStorage` only. It is **never**
  committed to the repo or embedded in the deployed page.
- Anyone with access to this browser profile can read it, so use a
  least-privilege, short-lived, single-repo token.
- Do not enable sync on a shared/public kiosk.

## Notes / limitations

- After a commit, the editor sees the change immediately (read via API), but
  other visitors see it only after GitHub Pages rebuilds and its CDN cache
  refreshes (typically under a couple of minutes).
- Single-editor model. Concurrent editors use last-write-wins with one retry on
  a stale-SHA conflict.

## Automated run results (`results.json`)

The **Result** column can be filled automatically from CI test runs, separately
from the manually-managed `data/test-cases/*.json`.

- CI writes `data/results.json`. Shape:
  ```json
  {
    "updatedAt": "2026-07-04T05:00:00Z",
    "results": {
      "W-003": { "status": "passed", "date": "2026-07-04", "env": "staging", "browser": "chrome", "runUrl": "https://github.com/.../actions/runs/123" }
    }
  }
  ```
  `status` is one of `passed` / `failed` / `flaky` / `skipped`.
- The dashboard fetches `results.json` publicly via Pages (no token) and shows the
  outcome as a colored badge in the Result column, matched by test-case **id**.
- `results.json` is **never** written by the dashboard UI, and run results are
  **not** merged into `data/test-cases/*.json`, so manual edits + syncs never clobber them
  (and CI never clobbers your test-case edits).

### Linking a CI test to a dashboard test case

Tag the automated test with the dashboard id as `@W-<n>` / `@M-<n>`. In the
`qa-automation` Playwright suite:

```ts
baseTest(
  "Verify if `Trade-Indicators` data ... are rendered as expected",
  { tag: util.addTags(tagCom, ["@prod", "@smoke", "@W-003"]) },
  async ({ page }) => { /* ... */ },
);
```

The workflow (`.github/workflows/ui-e2e-tests.yml`) parses `test-results.json`,
extracts each `@W-<n>` / `@M-<n>` tag, maps its status, and merges into this
repo's `results.json`. Tests without such a tag simply don't report a result.
Requires a `DASHBOARD_REPO_TOKEN` secret (fine-grained PAT, Contents: read/write
on this repo) in the `qa-automation` repo.

### Run history & the Runs page

The same CI step also **appends** each run to `runs.json` (last 100 runs):

```json
{
  "updatedAt": "…",
  "runs": [
    { "id": "123", "date": "2026-07-04", "env": "staging", "browser": "chrome",
      "runUrl": "…", "totals": { "passed": 2, "failed": 1, "flaky": 0, "skipped": 0 },
      "results": { "W-003": "passed", "W-004": "failed" } }
  ]
}
```

The **Runs** tab reads `runs.json` and shows a pass-rate trend line plus a row per
run (stacked pass/fail bar + counts). **Details** opens a run breakdown with the
list of failed/flaky test cases. On the Test cases tab, **Trend** on any row shows
that test case's pass/fail timeline across runs (flakiness at a glance). All
charts are inline SVG — no external libraries.

## Deploy to GitHub Pages

1. Commit this folder to the repository.
2. Repository Settings → Pages → Deploy from a branch → `main`, `/root`.
3. The dashboard is served at `/<repo>/ds/`.
