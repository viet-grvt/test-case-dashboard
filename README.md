# Test Case Dashboard

A static dashboard for tracking test case results. It runs on GitHub Pages with
no server, and can commit changes back to `data.json` in this repo through the
GitHub API.

## How it works

- The UI is plain HTML, CSS, and JavaScript.
- Data is read from `data.json`.
- Edits and deletes are applied instantly in the browser and, when a GitHub
  token is configured, committed back to `data.json` in the repo. GitHub Pages
  then redeploys and every visitor sees the update.
- Without a token the dashboard is **local-only**: changes stay in this
  browser's `localStorage` and are not shared.

## Why changes used to revert

The old version re-merged `data.json` over `localStorage` on every reload, so
`data.json` always won — edits were overwritten and deleted rows reappeared.
Now `data.json` (read live via the GitHub API when a token is set) is the single
source of truth, and mutations are committed back to it.

## Enabling repo sync

1. Create a **fine-grained Personal Access Token**:
   GitHub → Settings → Developer settings → Fine-grained tokens.
   - Repository access: **Only select repositories** → this repo.
   - Permissions: **Contents → Read and write**.
   - Set a short expiration.
2. Open the dashboard, click **⚙ Sync settings**.
3. Paste the token, confirm Owner / Repo / Branch / Path, then **Lưu & kết nối**.
   Defaults: `gravity-technologies` / `qa-automation` / `main` / `ds/data.json`.

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
from the manually-managed `data.json`.

- CI writes `results.json` at the repo root. Shape:
  ```json
  {
    "updatedAt": "2026-07-04T05:00:00Z",
    "results": {
      "TC-108": { "status": "passed", "date": "2026-07-04", "env": "staging", "browser": "chrome", "runUrl": "https://github.com/.../actions/runs/123" }
    }
  }
  ```
  `status` is one of `passed` / `failed` / `flaky` / `skipped`.
- The dashboard fetches `results.json` publicly via Pages (no token) and shows the
  outcome as a colored badge in the Result column, matched by test-case **id**.
- `results.json` is **never** written by the dashboard UI, and run results are
  **not** merged into `data.json`, so manual edits + syncs never clobber them
  (and CI never clobbers your test-case edits).

### Linking a CI test to a dashboard test case

Tag the automated test with the dashboard id as `@TC-<id>`. In the
`qa-automation` Playwright suite:

```ts
baseTest(
  "Verify if `Trade-Indicators` data ... are rendered as expected",
  { tag: util.addTags(tagCom, ["@prod", "@smoke", "@TC-108"]) },
  async ({ page }) => { /* ... */ },
);
```

The workflow (`.github/workflows/ui-e2e-tests.yml`) parses `test-results.json`,
extracts each `@TC-<id>` tag, maps its status, and merges into this repo's
`results.json`. Tests without a `@TC-<id>` tag simply don't report a result.
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
      "results": { "TC-108": "passed", "TC-109": "failed" } }
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
