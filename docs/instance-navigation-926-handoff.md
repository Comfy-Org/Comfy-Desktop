# Instance / Window Navigation (#926)

Given the **current view** (Dashboard | Instance | Cloud) and the **clicked
target**, decide whether to switch in place, restart, focus an existing window,
or open a new one.

The whole behavior matrix is **one pure function** —
[`decideNavigation`](../src/shared/navigation/navDecision.ts) — consumed by the
renderer (CTA label + caret) and main (executor). **To change a behavior, edit
that table and its test.**

**Cloud ≡ Remote, with one asymmetry.** `navClass` folds `remote → cloud` (no
local process), so a Remote *host* navigates like a Cloud host, and a Remote
*target* routes through the Cloud-target cells. They diverge only on
**stoppability**: a remote session can be stopped, a cloud session can't — so the
caret offers **Stop** for a running remote and **nothing** for a running cloud.

## Behavior matrix

`Caret ▾` = the footer split-button's dropdown. **Rule:** "Open in new window"
shows only when the target is **not running** (a running one can't open a second
window); once running the caret offers **Stop** (remote) or nothing (cloud).

| # | Current view | Target | State | Primary CTA | Caret ▾ |
|---|---|---|---|---|---|
| 1 | Dashboard | Dashboard | — | no-op | – |
| 2 | Dashboard | Instance | stopped | Start (same window) | – |
| 3 | Dashboard | Instance | running elsewhere | Switch (focus) | – |
| 4 | Dashboard | Cloud | stopped | Open Cloud (same window) | Open in new window |
| 5 | Dashboard | Cloud | running elsewhere | Switch (focus) | – |
| 6 | Dashboard | Remote | stopped | Open Remote (same window) | Open in new window |
| 7 | Dashboard | Remote | running elsewhere | Switch (focus) | Stop |
| 8 | Dashboard | + New Instance | — | New Install (wizard) | – |
| 9 | Instance | Dashboard | — | Open Dashboard (new window; instance keeps running) | – |
| 10 | Instance | self | running here | Restart | Stop |
| 11 | Instance | Instance B | stopped | Switch (swap in place) | Open in new window → 3-way confirm¹ |
| 12 | Instance | Instance B | running elsewhere | Switch (focus) | – |
| 13 | Instance | Cloud | stopped | Open Cloud (new window; instance keeps running) | – |
| 14 | Instance | Cloud | running elsewhere | Switch (focus) | – |
| 15 | Instance | Remote | stopped | Open Remote (new window; instance keeps running) | – |
| 16 | Instance | Remote | running elsewhere | Switch (focus) | Stop |
| 17 | Cloud | Dashboard | — | Open Dashboard (new window²) | – |
| 18 | Cloud | Instance | stopped | Open in new window (cloud keeps running) | – |
| 19 | Cloud | Instance | running elsewhere | Switch (focus) | – |
| 20 | Cloud | self | running here | Restart³ | – |
| 21 | Cloud | Cloud/Remote | stopped | Open in new window | – |
| 22 | Cloud | Cloud | running elsewhere | Switch (focus) | – |
| 23 | Cloud | Remote | running elsewhere | Switch (focus) | Stop |
| 24 | Cloud | + New Instance | — | New Install (wizard, new window) | – |

¹ Fires only when the host is a local install (the swap would stop its process):
an in-drawer dialog — *Switch* (stop A, swap B in) / *Open in new window* (keep A)
/ *Cancel*. Cloud/remote/dashboard hosts have nothing to stop → straight switch.

² **Deviation:** the matrix specified same-window. The "Open Dashboard" chip
routes through `activate('new-window')`, not the table — kept until the chip
consults `decideNavigation`.

³ Matrix row 16 wanted a *second* cloud window; a second view of one session
isn't supported (single-window auth). The `allowDuplicate` plumbing is reserved
for a future implementation.

## How it fits together

- [`navDecision.ts`](../src/shared/navigation/navDecision.ts) — the table.
  `NavInput (view × target × run) → NavDecision (window, verb, secondary)`.
- [`viewKind.ts`](../src/shared/viewKind.ts) — `ViewKind`/`Category`/`NavClass`
  vocabulary + `navClass` (`remote ⇒ cloud`).
- [`useInstanceNavState.ts`](../src/renderer/src/composables/useInstanceNavState.ts)
  — read-model: derives `NavInput` facts (reuses `useInstallCta` for run-state).
- [`useInstanceActions.ts`](../src/renderer/src/composables/useInstanceActions.ts)
  — dispatcher: routes a decision's verb onto the bridge.
- [`ComfyUISettingsContent.vue`](../src/renderer/src/components/settings/ComfyUISettingsContent.vue)
  — footer CTA + caret. Per-category wording ("Open Cloud" vs "Open Remote"); the
  caret's Stop item is the install's existing `stop` action (absent for cloud).
- [`index.ts`](../src/main/index.ts) — `pickInstallFromPicker` (swap; `confirmed`
  skips main's modal) and `openInstallInNewWindow` (focus-existing else spawn).
- The 3-way switch prompt lives in
  [`InstancePickerView.vue`](../src/renderer/src/comfyTitlePopup/InstancePickerView.vue)
  (`confirmSwitch`).

## Tests

- [`navDecision.test.ts`](../src/shared/navigation/navDecision.test.ts) — every
  cell + the full `view × target × run × intent` cross-product (totality), plus a
  guard that no reachable combo yields a no-op CTA, and that every CTA label key
  resolves in `locales/en.json`.
- [`useInstanceActions.test.ts`](../src/renderer/src/composables/useInstanceActions.test.ts)
  — verb → bridge routing; cloud-capacity + kill-confirm gates; 3-way outcomes.
- [`useInstanceNavState.test.ts`](../src/renderer/src/composables/useInstanceNavState.test.ts)
  — run-state derivation; remote⇒cloud fold.
- [`ComfyUISettingsContent.test.ts`](../src/renderer/src/components/settings/ComfyUISettingsContent.test.ts)
  — CTA label/decision per host; caret = Stop (running remote) / empty (running
  cloud) / new-window (stopped).
- `e2e/nav-matrix-{dashboard,instance,cloud}.test.ts` — same-window launch,
  focus-existing, new-window spawn, `allowDuplicate` primitive (via recorded IPC
  + live `BrowserWindow` counts). Rebuild (`pnpm run build`) before running — e2e
  uses the built bundle.

## Manual check

`pnpm dev`, then with two local installs (A, B) + Cloud/Remote available, walk
the matrix rows. Spot-checks worth confirming:
- A running **remote** target's caret shows **Stop**; a running **cloud** target
  shows **no caret** (just Switch/focus).
- Cloud/Remote → a *different* Cloud/Remote target shows a live CTA, never a dead
  "Start".
- Local restart still shows the in-drawer "Restart instance?" confirm; cloud/
  remote actions never show a local-process kill confirm.
