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
