# E2E and Lifecycle Testing

This document defines the test categories used in this repo, the zero-mock policy for
lifecycle tests, and an inventory of every Playwright spec. Background:
[#1242 — Lifecycle tests are very stale and not used now because of that staleness](https://github.com/Comfy-Org/Comfy-Desktop/issues/1242).

## Test categories

| Category | What it is | Command | Runs in CI |
| --- | --- | --- | --- |
| **Unit** | Fast Vitest tests of individual modules. | `pnpm test` | Every PR |
| **Integration** | Vitest suite with its own config (`vitest.integration.config.ts`). | `pnpm run test:integration` | Every PR |
| **E2E** | Playwright tests that drive the real built app, but **may** use dev hooks to inject synthetic state and may assert on IPC dispatch instead of real side effects. Must be fast. Tagged `@windows` / `@macos` / `@linux`. | `pnpm run test:e2e:<platform>` | Every PR, per platform |
| **Lifecycle** | Playwright tests that validate full user flows with **zero mocking** during app execution: real clicks, real downloads, real git, real disk. Tagged `@lifecycle`. | `pnpm run test:e2e:lifecycle` | Nightly + manual (`lifecycle.yml`) |

The `lifecycle` Playwright project has a 180 s default per-test timeout
(`playwright.config.ts`); individual heavyweight steps raise it with `test.setTimeout`.

> [!WARNING]
> `pnpm run test:e2e` with no `--project` runs **all** projects, including `lifecycle` —
> which downloads ~500 MB and performs real installs. Use the per-platform or
> per-project scripts unless that is what you want.

## Zero-mock policy (lifecycle tests)

Lifecycle tests replace manual release testing. A human tester does not mock the app,
so lifecycle tests must not either. During app execution the following are
**forbidden** in `@lifecycle` tests:

- Monkey-patching Electron APIs or intercepting network routes
- Dev hooks that inject state the product normally computes:
  `seedDownloads`, `setInstallUpdate`, `setAppUpdateState`, `seedRunningSession`
- Local substitutes for real services (GitHub, R2, cloud.comfy.org)
- Synthetic success/failure responses, or editing product state to fake an outcome
- Triggering the flow under test by calling `window.api` directly (e.g.
  `runAction`, `probeInstallation`) or by synthesizing internal IPC messages
  (e.g. a main→renderer `wc.send`) instead of driving the real UI control — a
  broken button must fail these tests, since replacing manual click-through
  testing is their entire purpose. Read-only `window.api` queries
  (`getSnapshots`, `getDetailSections`, …) remain fine for assertions

The following **scaffolding** is allowed, because it stages the scenario rather than
faking the product's behavior:

- The isolated per-run profile directory and its cleanup (`electronHarness.ts`),
  including the harness's global `dialog.showErrorBox` no-op — a native crash dialog
  would hang the run instead of failing it
- Staging the scenario via `SeedOptions`: `settings` and `onSetup` apply before
  Electron launches; `installations` (and their `snapshots`) are written by the
  harness after launch but before the test interacts — e.g. a fixture git repo, a
  legacy install tree, or snapshot envelopes
- Stubbing native OS file dialogs (`showOpenDialog` / `showSaveDialog`) with a
  predetermined path — Playwright cannot drive OS-native dialogs. The stub may only
  supply the path; it must never fake the operation's result
- Manipulating pre-conditions that only encode elapsed time (e.g. `ageReleaseCache`)
  before the flow under test
- Observation-only hooks (`getIpcInvocations`, `getRunningSessionSnapshot`,
  `getTitlePopupBounds`, …) — for assertions alongside, not instead of, real side
  effects
- Reusing byte-identical cached downloads when download behavior is not what the test
  validates

**Independence:** every lifecycle spec must pass on a fresh profile without any other
spec having run first. Reusing artifacts from a previous run (e.g. a cached download)
is fine only if the spec still passes without them. Serial `test.describe.configure`
chains inside one spec file are acceptable; cross-file ordering dependencies are not.

## Spec inventory

Snapshot of `e2e/` as of 2026-07. "Meets zero-mock bar" applies the policy above to
`@lifecycle`-tagged specs; `n/a` means the spec is (correctly) an E2E test.

| Spec | Tags | Meets zero-mock bar | Evidence |
| --- | --- | --- | --- |
| `cancel-flow.test.ts` | platform | n/a | `seedRunningSession` injects a synthetic running session. |
| `chooser.test.ts` | platform | n/a | Seeded settings only; UI assertions. |
| `copy-update-destination.test.ts` | platform | n/a | Copy result is synthetic; the real copy handler is bypassed; asserts IPC dispatch. |
| `dashboard-delete-flow.test.ts` | `@lifecycle` | Yes (light) | Really deletes the seeded install directory. |
| `deep-links.test.ts` | platform | n/a | Replays the internal `panel-trigger-overlay` IPC directly into the panel and asserts downstream IPC dispatch; never exercises real OS/app `comfy://` handling. |
| `devhooks-smoke.test.ts` | platform | n/a | Exists to test the dev-hooks bridge itself. |
| `dismiss-error.test.ts` | platform | n/a | Injects the error into the renderer store at runtime (`__e2eRenderer.seedErrorInstance`). |
| `downloads-shelf.test.ts` | platform | n/a | Injects downloads-tray state via `seedDownloads`. |
| `dropdowns.test.ts` | platform | n/a | UI regression tests. |
| `lifecycle-add-existing.test.ts` | `@lifecycle` | Yes (light) | Real probe + tracking against a staged git repo, driven through the waffle menu → TrackModal → Browse → Track Install chain; native directory picker stubbed with the staged path. |
| `lifecycle-cloud.test.ts` | `@lifecycle` | Yes | Real navigation to `https://cloud.comfy.org/`. |
| `lifecycle-copy-update-fail.test.ts` | `@lifecycle` | Yes (light) | Real local copy chained into a real update failure, driven through the picker Update tab's Copy & Update button; failure text asserted from the durable app log. Picker opened via direct `openInstancePicker`, not a UI entry control. |
| `lifecycle-copy.test.ts` | `@lifecycle` | Yes (light) | Real local disk copy of a staged install, driven through the picker More → Copy flow and prompt UI. Picker opened via direct `openInstancePicker`, not a UI entry control. |
| `lifecycle-delete-untrack.test.ts` | `@lifecycle` | Yes (light) | Real directory preservation/removal on disk, driven through the dashboard kebab → menu → panel confirm chain. |
| `lifecycle-first-use-migrate.test.ts` | `@lifecycle` | Yes (light) | Real first-use flow into the migrate confirm; the adoption op really runs and its fixture-determined outcome (validate-venv failure on the stub `.venv`) renders in the progress error surface. A successful adoption needs a live legacy venv (python + torch), out of CI budget. |
| `lifecycle-first-use-skip.test.ts` | `@lifecycle` | Yes | Real ToS → Local → Continue chain into post-consent, then the waffle menu's Skip Onboarding item clicked in the real popup. |
| `lifecycle-migrate.test.ts` | `@lifecycle` | Yes (light) | Real auto-tracker detection on boot; kebab → Migrate → adoption confirm → Cancel driven through the real UI. The final test is a read-only `getFieldOptions` contract guard on the R2 release/variant feed the migrate flow's silent variant pick consumes. |
| `lifecycle-periodic-update-check.test.ts` | `@lifecycle` | Yes | Real background re-fetch of the release cache. |
| `lifecycle-snapshot-export.test.ts` | `@lifecycle` | Yes (light) | Writes real snapshot envelope JSON to disk; native save dialog stubbed with a fixed path. Picker opened via direct `openInstancePicker`, not a UI entry control. |
| `lifecycle-snapshot-import.test.ts` | `@lifecycle` | Yes (light) | Consumes a real envelope through the toolbar Import flow; import stages a restore target and must not commit history (#1137); native open dialog stubbed with a fixed path. Picker opened via direct `openInstancePicker`, not a UI entry control. Import success is only staged, never committed - a committed staged-import success path is an open coverage gap. |
| `lifecycle-snapshot-restore.test.ts` | `@lifecycle` | Yes (light) | Live restore moves real HEADs; both restore operations drive the real expanded-row Restore button and confirm. Picker opened via direct `openInstancePicker`, not a UI entry control. Seeded snapshots carry `skipPipSync` (fixture has no Python env), so the real pip-sync phase of restore is an open coverage gap. |
| `lifecycle-snapshot-roundtrip.test.ts` | `@lifecycle` | Yes (light) | Real export from install A, real import preview into install B proving envelope round-trip; import stages without committing history (#1137); native dialogs stubbed with fixed paths. Picker opened via direct `openInstancePicker`, not a UI entry control. |
| `lifecycle-snapshot-share.test.ts` | `@lifecycle` | Yes (light) | Real export of the latest snapshot; native save dialog stubbed with a fixed path. Picker opened via direct `openInstancePicker`, not a UI entry control. |
| `lifecycle-snapshot.test.ts` | `@lifecycle` | Yes (light) | Real snapshot capture driven through the picker save CTA and prompt UI; asserted via the rendered snapshot row plus read-only backend queries. Picker opened via direct `openInstancePicker`, not a UI entry control. |
| `lifecycle-startup-update-check.test.ts` | `@lifecycle` | Yes | One real `git ls-remote` to github.com per startup. |
| `lifecycle-update-check.test.ts` | `@lifecycle` | Yes (light) | Live `git ls-remote --tags` against Comfy-Org/ComfyUI, triggered by the real Check for Update button and Update-tab clicks; `ageReleaseCache` is time scaffolding. Picker opened via direct `openInstancePicker`, not a UI entry control. |
| `lifecycle.test.ts` | `@lifecycle` | Yes | Real ~500 MB install driven through the UI; every picker flow enters through a real control (dashboard kebab -> Manage, or the running host's title-bar install pill), stop + return drives the stopped card's Return to Dashboard button, snapshot capture goes through the Snapshots tab Save CTA, and both deletes run the kebab -> Delete -> confirm chain. Remaining scaffolding: a panel remount (`ensureInstallPanelView`) so read-only `window.api` assertions stay reachable, and closing the extra window the multi-window test opened. |
| `nav-matrix-cloud.test.ts` | platform | n/a | Seeded cloud record; `clearRunningSessions` dev hook between tests; asserts IPC dispatch + window count. No real cloud attach (that is `lifecycle-cloud.test.ts`). |
| `nav-matrix-dashboard.test.ts` | platform | n/a | `seedRunningSession`; asserts window/IPC behavior. |
| `nav-matrix-instance.test.ts` | platform | n/a | `seedRunningSession`; asserts window/IPC behavior. |
| `picker-cluster.test.ts` | platform | n/a | `seedRunningSession`; asserts IPC dispatch. |
| `picker-settings-staleness.test.ts` | platform | n/a | Seeded-state UI regression test. |
| `picker-stop-confirm.test.ts` | platform | n/a | `seedRunningSession` injects the running state under test. |
| `port-conflict.test.ts` | platform | n/a | Synthetic `portConflict` operation state; no real port conflict. |
| `progress-error-overflow.test.ts` | platform | n/a | Pure UI overflow regression test. |
| `progress-reboot.test.ts` | platform | n/a | `injectRetryableProgressError` fakes a failing operation and its retry outcome. |
| `quit-flow.spec.ts` | `@macos` | n/a | Tray-close quit behavior. |
| `title-bar-hover-gate-comfy-window.test.ts` | platform | n/a | Hover-gate state machine (probes cloud.comfy.org for the host window). |
| `title-bar-hover-gate.test.ts` | platform | n/a | Hover-gate state machine. |
| `update-pills.test.ts` | platform | n/a | Injects update states via `setAppUpdateState` / `setInstallUpdate`. |
| `window-visible.spec.ts` | platform | n/a | Launch smoke test. |

Thirteen specs formerly tagged `@lifecycle` were retagged to the platform projects: they
inject synthetic runtime state or assert dispatch instead of real side effects, which
makes them E2E tests by the definitions above. The `lifecycle-` filename prefix was
dropped where present so filenames match projects. "Yes (light)" specs meet the bar
with allowed scaffolding (staged fixtures, stubbed native OS dialogs, read-only
queries); "Yes" specs need none.

## Running lifecycle tests

```bash
pnpm run build
pnpm run test:e2e:lifecycle            # whole lifecycle project
pnpm exec playwright test --project=lifecycle lifecycle-copy.test.ts   # one spec
```

The harness prints the per-run profile directory
(`[lifecycle-harness] fresh profile dir: …`); re-export it as `LIFECYCLE_REUSE_DIR` to
re-run individual tests against that profile.

In CI, the lifecycle project runs nightly and on demand via the **Lifecycle Tests**
workflow (`.github/workflows/lifecycle.yml`). It is not PR-blocking.
