# Shared Desktop components

This project makes `@comfyorg/design-system` the owner of reusable controls and
their interaction behavior. Desktop owns installation workflows, operating-system
integration, and thin adapters between those workflows and the shared controls.

Starting point: `bl/desktop-as-a-platform` at `1020bea0`, after #1899 (shared
Void theme) and #1902 (shared Input).

## Completion requirements

- [x] Input groups, native text/number fields, checkboxes, switches, and disclosure
      transitions use the shared package wherever their semantics fit.
- [x] Dropdowns, action menus, context menus, and tooltips use shared interaction
      primitives, including inside dialogs and near viewport edges.
- [x] Dialogs, alerts, prompts, and action sheets share one dialog foundation.
- [x] Repeated button styling uses package variants where appropriate. Remaining
      custom controls have a specific layout or operating-system reason.
- [x] Obsolete implementations and compatibility styling are removed rather than
      retained as parallel control systems.
- [x] A deterministic visual suite covers shared controls and representative
      Desktop screens.
- [x] Keyboard navigation, disabled states, validation, focus return, nested
      overlays, and cross-window dismissal are verified.
- [x] Unit, integration, type, lint, formatting, build, and relevant Electron
      checks pass on the integrated change.
- [x] Reviewable native GitHub PR stack and handoff record identify changes,
      intentional visual differences, verification evidence, and remaining risks.

## Ownership

| Layer                                                           | Owner                     |
| --------------------------------------------------------------- | ------------------------- |
| Theme and reusable component styling                            | `@comfyorg/design-system` |
| Input, selection, menu, tooltip, dialog interaction primitives  | `@comfyorg/design-system` |
| Desktop field models, update/commit semantics, permission rules | Desktop adapters          |
| Installation/launch/update workflows and rich dialog content    | Desktop views             |
| Native title bar, window controls, independent embedded views   | Electron/Desktop          |

An adapter may translate values, expose existing events, or dismiss on a Desktop
window boundary. It should not reimplement a component's generic keyboard,
positioning, or focus system.

## Work and verification log

The implementation uses the existing pinned `@comfyorg/design-system`
`1.3.0-alpha.0`. It needs no package publication or data migration.

### Review order

These pull requests form native GitHub stack 1907. The stack targets
`bl/desktop-as-a-platform`; landing it does not publish a Desktop release or merge
the platform branch into `main`.

| Order | Change                                                           | Pull request                                                  |
| ----- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| 1     | Shared dropdown, menu, and tooltip behavior                      | [#1904](https://github.com/Comfy-Org/Comfy-Desktop/pull/1904) |
| 2     | Grouped inputs, form controls, switches, disclosure              | [#1905](https://github.com/Comfy-Org/Comfy-Desktop/pull/1905) |
| 3     | Dialogs, takeovers, focus and dismissal                          | [#1906](https://github.com/Comfy-Org/Comfy-Desktop/pull/1906) |
| 4     | Popup controls, tabs and directory menus                         | [#1908](https://github.com/Comfy-Org/Comfy-Desktop/pull/1908) |
| 5     | Shared view actions, account/workspace menus, cleanup            | [#1909](https://github.com/Comfy-Org/Comfy-Desktop/pull/1909) |
| 6     | Base-versus-PR visual report, profile isolation and this handoff | [#1910](https://github.com/Comfy-Org/Comfy-Desktop/pull/1910) |

### Deliberate visual changes

- Grouped inputs adopt the package's control sizing, padding, invalid/focus rings,
  and icon/addon layout. Fields marked `mono` now actually use a monospace font.
- Checkboxes and switches use the package's appearance. Disabled or restricted
  controls still preserve their application permission rules.
- Menu rows, selection highlights, tooltip surfaces, and dialog actions use the
  package's variants rather than copied local paint recipes.
- Dialog content and Desktop's full-screen brand layouts remain application
  compositions. The package handles their focus, layers, and scroll locks.

### Intentional Desktop-specific code

- Ten raw button elements remain in the native title-bar and title-tooltip
  renderers. They are window-chrome controls with separately sized embedded
  views and operating-system drag/focus behavior, not a second generic button
  system. Their interaction tests remain in the Electron suite.
- Installation cards retain their layout and workflow actions. A card containing
  independent buttons is not converted into a nested HTML button.
- Clipboard feedback, field models, permission gates, and installation actions
  stay local. Thin adapters translate these contracts to shared controls.
- Active legacy color aliases and brand layout tokens remain for Desktop-owned
  surfaces. The shared theme remains the source of semantic control colors.

### Local verification

- The integrated renderer suite passed 1,682 tests across 117 files after the
  final view cleanup.
- All 13 visual scenarios passed three consecutive runs (39 executions) without
  retries. They include the real dashboard, Desktop Settings at two widths,
  first-use consent, typed/invalid/masked fields, selection, menus, tooltips,
  prompts, action sheets and nested dialogs.
- Before the switch to base comparisons, a deliberate one-pixel input
  displacement failed the stored-baseline assertion. The current report records
  visual differences without failing the check.
- The profile-isolation Electron test passed on macOS. Twelve additional Electron
  checks passed for chooser navigation, popup reuse/dismissal, title tooltips,
  and install-switch settings.
- The Electron input helpers now send actual mouse and keyboard events instead
  of JavaScript `.click()` calls. Sixteen Electron checks passed for trusted
  input events, dropdown persistence, keyboard navigation, storage settings,
  and existing chooser/popup paths. A lost evaluation response never
  automatically replays a click or key press. Fill retries reselect and replace
  text; toggle and selection helpers may retry after checking the current state.
- All 70 integration tests passed.
- The original 16 Linux baselines were reviewed and have now been removed.
  Every run renders both the PR and its base on the same machine; no stored
  images need updating or approval.
- Type, lint, format, and production build checks passed during integration.
  Canonical Linux unit, integration, type, lint, and formatting checks also passed
  on the integrated source in
  [CI run 41618499557](https://github.com/Comfy-Org/Comfy-Desktop/actions/runs/41618499557).

### Review and release boundary

The six PRs are ready for review in the order listed above. This work does not
merge them, publish a design-system package, or release Desktop. Check the latest
head's CI on each PR before landing the stack; the full Electron jobs cover
macOS, Windows, and Linux.

The visual report compares the current PR with its exact base using the same
fixture, including the changes listed under Deliberate visual changes. Pixel
differences are review information; runtime and interaction failures still fail
the check. The report covers only the captured states.

The full local unit run exposed four pre-existing macOS fixture failures in
`agentUvReaper.test.ts` and `ipc/sessionActions/delegate.test.ts`. Those tests
create a shell script named `uv` and wait for `ps` to report that name; this
macOS reports `sh`. The same failure was independently reproduced with unchanged
base code, before the product action ran. It is not covered up with retries or
changed assertions. Canonical Linux CI results remain the final unit-suite gate.

### Running the checks

```sh
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm test
pnpm run test:integration
pnpm run build
pnpm exec playwright install chromium
pnpm run test:visual:unit
pnpm run test:visual --base origin/bl/desktop-as-a-platform
pnpm exec playwright test --project=macos e2e/profile-isolation.test.ts e2e/chooser.test.ts e2e/dropdowns.test.ts e2e/picker-settings-staleness.test.ts
```

See [the visual test guide](../tests/visual/README.md) for before/after/diff report
review and CI artifact instructions. Both renders are fresh, including after a
Playwright image or intentional design change.

### Test profile isolation

The Electron test launcher points every launch at a per-run profile through the
environment and needs no test code in the app. macOS ignores `HOME` for Electron's
paths, so it also sets `CFFIXED_USER_HOME`. On Windows, `APPDATA` and `LOCALAPPDATA`
are redirected, but `app.getPath('home')` is not asserted because Windows may
resolve it without using the environment.
