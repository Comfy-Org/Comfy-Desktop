# Desktop visual comparison report

Each run renders the PR and its base on the same machine, then writes a report
with base, PR, and highlighted difference images. Appearance changes are
informational: they do not fail the check. No baseline images are committed,
downloaded from a previous run, or regenerated for approval.

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
git fetch origin
pnpm test:visual --base origin/bl/desktop-as-a-platform
```

Choose the branch your PR targets (for a PR targeting main, use `origin/main`).
An exact commit SHA also works. The report compares against the commit your work
branched from, so later commits on that branch do not appear as your changes. Open `visual-report/index.html` in a browser.
The head render includes local tracked edits, so macOS developers can compare
work in progress without committing or switching branches. All generated images
and reports are ignored by Git and replaced on the next run.

The runner creates a disposable base worktree and installs its own locked
dependencies with install scripts disabled. It copies only the current visual
fixture into that worktree, leaving production code and the dependency lockfile
unchanged. Each version is built with its own Vite and Tailwind. Both renders use
the current PR's scenarios and Playwright/browser version. This works even when
the base does not yet contain this test harness. The temporary worktree is removed
when the run finishes, including after Ctrl-C.

## CI and review

The **Visual report (base vs PR)** check compares the exact PR head with the commit
it branched from on the base. Merge-queue runs compare the queue head with its base.
Title and description edits do not rerun it; changing the PR's base does. The job summary lists changed scenes and links to the `visual-comparison`
artifact: download it, extract it, and open `index.html`. Expand unchanged scenes
as needed; changed scenes are open by default. Click an image to inspect it at
full size. `report.json` contains counts, dimensions, pixel differences and the
compared revisions. Per-version Playwright reports retain interaction failures
and traces for diagnosis.

CI uses the Playwright container in `.github/workflows/visual-regression.yml`.
Keep its tag in sync with Playwright in `pnpm-lock.yaml`. Local runs use the local
OS for both versions, so there is no macOS-versus-Linux baseline mismatch.
Viewport, pixel ratio, locale, time zone, theme and reduced-motion settings are
explicit. Fonts settle and Playwright captures stable images before comparison.
Pixel differences, including antialiasing, are reported without a pass threshold.

## Coverage and limits

The 13 scenarios capture 16 views of production controls, the dashboard, Desktop
Settings at two widths, and first-use consent. They cover validation, masked
values, booleans, disclosures, dropdowns, menus, tooltips, prompts, destructive
confirmations, and nested dialogs. Both versions use the same fixture and
interaction assertions with no retries. A runtime error or broken interaction in
the PR fails the check. The base cannot be changed by the PR, and it can fail
simply because the PR changed a label or added a scene, so a base failure does not
fail the check. Either way the report compares the scenes both versions captured
and marks the rest **not compared**, never as added or removed.

The in-memory host bridge does not exercise IPC, filesystem operations or native
window focus. Use Electron E2E tests for those. The report only compares the
captured states; it does not decide whether an appearance change is desirable.

Run `pnpm test:visual:unit` to check report generation without a browser.
