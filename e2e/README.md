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
| `chooser.test.ts` | platform | n/a | Seeded settings only; UI assertions. |
| `copy-update-destination.test.ts` | `@lifecycle` | **No — retag candidate** | Copy result is synthetic; the real copy handler is bypassed; asserts IPC dispatch. |
| `dashboard-delete-flow.test.ts` | `@lifecycle` | Yes (light) | Really deletes the seeded install directory. |
| `devhooks-smoke.test.ts` | platform | n/a | Exists to test the dev-hooks bridge itself. |
| `downloads-shelf.test.ts` | platform | n/a | Injects downloads-tray state via `seedDownloads`. |
| `dropdowns.test.ts` | platform | n/a | UI regression tests. |
| `lifecycle-add-existing.test.ts` | `@lifecycle` | Yes | Stages a real git repo (`git init` + tagged commit); real probe + tracking. |
| `lifecycle-cancel-flow.test.ts` | `@lifecycle` | **No — retag candidate** | `seedRunningSession` injects a synthetic running session. |
| `lifecycle-cloud.test.ts` | `@lifecycle` | Yes | Real navigation to `https://cloud.comfy.org/`. |
| `lifecycle-copy-update-fail.test.ts` | `@lifecycle` | Yes (light) | Real local copy; real update-failure branch on disk. |
| `lifecycle-copy.test.ts` | `@lifecycle` | Yes (light) | Real local disk copy of a staged install. |
| `lifecycle-deep-links.test.ts` | `@lifecycle` | **No — retag candidate** | Real `comfy://` deep links, but asserts IPC dispatch rather than end state. |
| `lifecycle-delete-untrack.test.ts` | `@lifecycle` | Yes (light) | Real directory preservation/removal on disk. |
| `lifecycle-dismiss-error.test.ts` | `@lifecycle` | **No — retag candidate** | Injects the error into the renderer store at runtime (`__e2eRenderer.seedErrorInstance`). |
| `lifecycle-first-use-migrate.test.ts` | `@lifecycle` | Strengthen or retag | Real first-use flow, but the R2 download action is asserted as dispatch only. |
| `lifecycle-first-use-skip.test.ts` | `@lifecycle` | Strengthen or retag | Real skip flow, but triggered by sending the skip IPC directly instead of clicking the File-menu item. |
| `lifecycle-migrate.test.ts` | `@lifecycle` | Yes (light) | Staged legacy install tree (pre-launch scaffolding); real migration preview. |
| `lifecycle-periodic-update-check.test.ts` | `@lifecycle` | Yes | Real background re-fetch of the release cache. |
| `lifecycle-picker-cluster.test.ts` | `@lifecycle` | **No — retag candidate** | `seedRunningSession`; asserts IPC dispatch. |
| `lifecycle-port-conflict.test.ts` | `@lifecycle` | **No — retag candidate** | Synthetic `portConflict` operation state; no real port conflict. |
| `lifecycle-progress-reboot.test.ts` | `@lifecycle` | **No — retag candidate** | `injectRetryableProgressError` fakes a failing operation and its retry outcome. |
| `lifecycle-snapshot-export.test.ts` | `@lifecycle` | Yes (light) | Writes real snapshot envelope JSON to disk; native save dialog stubbed with a fixed path. |
| `lifecycle-snapshot-import.test.ts` | `@lifecycle` | Yes (light) | Consumes a real envelope; writes a snapshot into the install; native open dialog stubbed with a fixed path. |
| `lifecycle-snapshot-restore.test.ts` | `@lifecycle` | Yes | Live restore against real git repos; moves real HEADs. |
| `lifecycle-snapshot-roundtrip.test.ts` | `@lifecycle` | Yes (light) | Real export from install A, real import into install B; native dialogs stubbed with fixed paths. |
| `lifecycle-snapshot-share.test.ts` | `@lifecycle` | Yes (light) | Real export of the latest snapshot; native save dialog stubbed with a fixed path. |
| `lifecycle-snapshot.test.ts` | `@lifecycle` | Yes (light) | Real snapshot capture via `runAction`. |
| `lifecycle-startup-update-check.test.ts` | `@lifecycle` | Yes | One real `git ls-remote` to github.com per startup. |
| `lifecycle-update-check.test.ts` | `@lifecycle` | Yes | Live `git ls-remote --tags` against Comfy-Org/ComfyUI; `ageReleaseCache` is time scaffolding. |
| `lifecycle.test.ts` | `@lifecycle` | Yes | Real ~500 MB install, real updater, real copies, real delete. |
| `nav-matrix-cloud.test.ts` | `@lifecycle` | **No — retag candidate** | Seeds a cloud installation record, drives the picker-popup bridge directly, and avoids a real cloud attach. |
| `nav-matrix-dashboard.test.ts` | `@lifecycle` | **No — retag candidate** | `seedRunningSession`; asserts window/IPC behavior. |
| `nav-matrix-instance.test.ts` | `@lifecycle` | **No — retag candidate** | `seedRunningSession`; asserts window/IPC behavior. |
| `picker-settings-staleness.test.ts` | `@lifecycle` | **No — retag candidate** | Seeded-state UI regression test. |
| `picker-stop-confirm.test.ts` | `@lifecycle` | **No — retag candidate** | `seedRunningSession` injects the running state under test. |
| `progress-error-overflow.test.ts` | `@lifecycle` | **No — retag candidate** | Pure UI overflow regression test. |
| `quit-flow.spec.ts` | `@macos` | n/a | Tray-close quit behavior. |
| `title-bar-hover-gate-comfy-window.test.ts` | platform | n/a | Hover-gate state machine (probes cloud.comfy.org for the host window). |
| `title-bar-hover-gate.test.ts` | platform | n/a | Hover-gate state machine. |
| `update-pills.test.ts` | platform | n/a | Injects update states via `setAppUpdateState` / `setInstallUpdate`. |
| `window-visible.spec.ts` | platform | n/a | Launch smoke test. |

"Retag candidate" specs are E2E tests by the definitions above: they inject synthetic
runtime state or assert dispatch instead of real side effects. Retagging them to the
platform projects would add them to PR-blocking CI, so each needs a platform-stability
check first — that migration is tracked separately from this document. "Strengthen or
retag" specs exercise a mostly-real flow with one weak link (a direct IPC trigger or a
dispatch-only assertion); fixing that link keeps them in `@lifecycle`, otherwise they
should be retagged too.

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
