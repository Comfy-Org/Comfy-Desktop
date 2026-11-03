# Desktop visual regression tests

Run `pnpm test:visual` after installing the pinned browser with
`pnpm exec playwright install chromium`. The suite renders production Vue
components, the real dashboard, and the real Desktop Settings view with an
in-memory host bridge. It never launches ComfyUI or reads an installed profile.

CI uses Ubuntu 24.04, Node 22, and the Chromium revision pinned by the locked
Playwright dependency. The viewport, pixel ratio, locale, time zone, dark theme,
and reduced-motion preference are explicit. Inter is loaded from the repository
and fonts settle before capture. Screenshot comparison uses zero changed pixels;
the suite has no retries.

Baselines are platform-specific. Linux images are the canonical CI gate; macOS
images support local development. A browser version, font, OS, or intended
design change can require a deliberate baseline update.

## Updating images

1. Run `pnpm test:visual:update` in the matching environment.
2. Open the generated report with `pnpm exec playwright show-report visual-playwright-report`.
3. Inspect each changed image, including overflow, text clipping, focus rings,
   disabled/destructive states, and nested popups. Include before/after evidence
   in the PR when the appearance intentionally changes.
4. Commit only reviewed baselines. Never regenerate them just to silence a
   failing check.

When the initial Linux baseline directory is absent, CI generates all candidate
images and deliberately fails until they have been reviewed and committed.
An individual missing baseline also fails and uploads its candidate image.
Download the `visual-regression-linux` artifact, inspect the candidates, and add
them to the corresponding Linux snapshot paths. Subsequent runs must compare
successfully without update mode.

## Coverage and limits

The suite covers grouped inputs, validation, masked values, booleans,
disclosures, dropdowns, action menus, tooltips, prompts, confirmations, nested
dialogs, and dashboard/settings composition. Keyboard and state assertions
accompany screenshots so a visually identical but broken control still fails.

The host bridge is a fixture boundary, not coverage of IPC or filesystem
operations. Run the Electron E2E suite for actual window focus, inter-view
behavior, and host integration. Electron's test launcher uses an isolated app
and browser-session profile on every platform.
