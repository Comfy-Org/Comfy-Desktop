# Shared Desktop components

`@comfyorg/design-system` owns reusable controls and their interaction behavior.
Desktop owns installation workflows, operating-system integration, and thin adapters
between those workflows and the shared controls.

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

## Intentional Desktop-specific code

- Raw button elements remain in the native title-bar and title-tooltip renderers.
  They are window-chrome controls with separately sized embedded views and
  operating-system drag/focus behavior, not a second generic button system. Their
  interaction tests remain in the Electron suite.
- Installation cards retain their layout and workflow actions. A card containing
  independent buttons is not converted into a nested HTML button.
- Clipboard feedback, field models, permission gates, and installation actions
  stay local. Thin adapters translate these contracts to shared controls.
- Active legacy color aliases and brand layout tokens remain for Desktop-owned
  surfaces. The shared theme remains the source of semantic control colors.

## Running the checks

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
review and CI artifact instructions.

On macOS, `agentUvReaper.test.ts` and `ipc/sessionActions/delegate.test.ts` fail
without any code change: they create a shell script named `uv` and wait for `ps` to
report that name, while macOS reports `sh`. Linux CI is the gate for those tests.

## Test profile isolation

The Electron test launcher points every launch at a per-run profile through the
environment and needs no test code in the app. macOS ignores `HOME` for Electron's
paths, so it also sets `CFFIXED_USER_HOME`. On Windows, `APPDATA` and `LOCALAPPDATA`
are redirected. The isolation test does not read `home` or `downloads` there, because
Electron cannot resolve the Downloads folder inside a redirected Windows profile.
