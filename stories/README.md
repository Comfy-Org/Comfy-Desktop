# Desktop UI playground

Storybook lets contributors and reviewers inspect real Desktop renderer
components and screens without repeatedly launching Electron, acquiring a
workspace account, or downloading a ComfyUI environment to reach a particular
state. The same examples serve as repeatable browser interaction tests.

## Run and explore

Run `pnpm storybook` and open http://localhost:6006. Choose a story and interact
with it. Use the toolbar's remount button to reset it. Each component's Docs
page explains it and embeds isolated examples.

| Story                   | What to try                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Components → BaseSelect | Open the select, move with the arrow keys (disabled options are skipped), pick with Enter, or close with Escape or a click outside. |

### Create a New Instance

Under **Screens → Create a New Instance**, choose an example. Remounting resets
its sample data.

| Example                   | What to try                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Public Builds             | Change release/hardware, continue to the starter workflow picker.                         |
| Managed Builds            | Inspect a sample workspace build and switch its installation target.                      |
| Managed Install Requested | See the simulated handoff after Continue requests a Managed Build install.                |
| Sign In To Managed Builds | See the result of simulated sign-in; remount Public Builds to perform the click yourself. |
| No Compatible Builds      | Inspect the empty picker and disabled installation button.                                |
| Build Load Error          | Click Retry to recover the sample failed request.                                         |
| Install Error             | Inspect the alert after the sample installation request is rejected.                      |
| Low Disk Space            | Inspect the blocked starter workflow, then pick a smaller one or None to proceed.         |

**Public Builds** are the standard ComfyUI environments. **Managed Builds** are
packaged setups published to a Comfy platform workspace. The **wizard** is this
Create a New Instance screen.

The examples use a sample Windows/NVIDIA machine. Compatibility states are
predefined API responses, not the output of the real main-process compatibility
check. These stories cannot establish whether Python, PyTorch, or a GPU works on
a machine. Browser, folder, and install actions stay inside the preview; no files
are written and no external authentication is started. Public/remote submission
shows a preview-only alert. Managed submission displays a simulated handoff.

## Add a story

- Put `*.stories.ts` files under `stories/` and import the actual renderer
  component. Avoid copying product markup into the story.
- Shared production CSS and a fresh Pinia/i18n setup are configured in
  `.storybook/preview.ts`. Each story app disposes its Pinia once its components
  have unmounted, so their unmount hooks can still use stores, and stores then
  run their cleanup. Tailwind generates utilities only from `src/renderer`, so
  story-only wrapper markup uses scoped CSS or inline styles.
- Stories run without Electron, so `window.api` does not exist. A component that
  calls the preload API needs a sample implementation, checked against the
  production IPC types, installed for each mount and released when it unmounts.
- The setup screen's sample responses live in `desktopApi.ts`. Implement every
  preload method the screen calls. A missing method is `undefined`, and product
  code that feature-detects optional methods or catches preload errors silently
  takes its fallback path.
- Its decorator component installs a fresh fixture and resets shared modal state
  in its setup. On unmount it resets the modal and passes the fixture to
  `retireDesktopApi`. The fixture's methods then never settle, including through
  references a store kept (the auth store keeps `comfybuilder`), so the
  unmounted screen's late async work stops instead of throwing or continuing
  against a fixture no example shows. Calls it makes through `window.api` only
  after the next example has mounted reach that example's fixture. Retiring
  also clears the fixture's spies, which Storybook keeps for the page's
  lifetime, so their recorded calls do not keep the old fixture alive.
  Storybook re-runs `beforeEach` on toolbar and args changes without
  remounting, which would swap the fixture under the mounted screen. Keep
  `test.restoreMocks: false` so those rerenders do not clear the fresh spies'
  call history.
- Query `screen` (the document body) for popovers, takeover screens and alerts,
  which teleport outside the story canvas. Use condition-based assertions
  instead of sleeps.
- Keep Docs examples in separate iframes so their stores remain isolated.
  Proprietary fonts are not copied into this browser build; it uses the
  committed Inter fallback.

## Validate

```bash
pnpm run typecheck:storybook
pnpm run build-storybook
pnpm exec playwright install --only-shell chromium # once, for browser tests
pnpm run test:storybook
```

The tests use Storybook's Vitest addon with a single headless Chromium instance.
CI builds and uploads the static preview from the commit it checks out (for a
pull request, GitHub's merge with the base branch). It then runs these stories
from the same checkout against the Vite-served sources, not the uploaded
build, on the Node.js version pinned in the Storybook job of
`.github/workflows/ci.yml`.
