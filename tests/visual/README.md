# Desktop visual regression tests

Run `pnpm test:visual` after installing the pinned browser with
`pnpm exec playwright install chromium`. The suite renders production Vue
components, the real dashboard, and the real Desktop Settings view with an
in-memory host bridge. It never launches ComfyUI or reads an installed profile.

CI runs in the `mcr.microsoft.com/playwright` container named in
`.github/workflows/visual-regression.yml`, so the browser, fonts and system
libraries are pinned. Bump its tag whenever the Playwright version in
`pnpm-lock.yaml` changes, and expect to update the baselines with it. The viewport,
pixel ratio, locale, time zone, dark theme, and reduced-motion preference are
explicit. Inter is loaded from the repository and fonts settle before capture.
Screenshot comparison allows zero counted pixel differences at threshold 0, with
Playwright's standard antialias handling. This is a rendered-image regression
check, not a byte-for-byte image equality check. The suite has no retries.

Only the Linux images are committed, and they are the CI gate. Rendering differs
between operating systems, so other platforms' images are git-ignored. On a Mac,
run `pnpm test:visual` on the base branch to create local images, then again on
your change to compare against them.

## Updating images

When the comparison fails, CI regenerates the images and uploads them as the
`visual-baselines-linux` artifact, whether a baseline changed or is missing. The
`visual-regression-linux` artifact holds the report and diffs.

1. Inspect the report with
   `pnpm exec playwright show-report visual-playwright-report`, checking overflow,
   text clipping, focus rings, disabled/destructive states, and nested popups.
2. Replace the committed images with the regenerated ones:
   `gh run download <run-id> -n visual-baselines-linux -D tests/visual/__screenshots__/linux`
3. Commit only images you reviewed. Never regenerate them just to silence a failing
   check. CI checks that the committed images match, not who reviewed them.

## Coverage and limits

The suite covers grouped inputs, validation, masked values, booleans,
disclosures, dropdowns, action menus, tooltips, prompts, confirmations, nested
dialogs, and dashboard/settings composition. Keyboard and state assertions
accompany screenshots so a visually identical but broken control still fails.

The host bridge is a fixture boundary, not coverage of IPC or filesystem
operations. Run the Electron E2E suite for actual window focus, inter-view
behavior, and host integration. Electron's test launcher isolates the app and
browser-session profile on every platform.
