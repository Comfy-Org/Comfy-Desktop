# Testing

This repo has four test categories. They differ in what they are allowed to fake,
how fast they run, and when CI runs them. For the full lifecycle zero-mock policy
and a per-spec inventory, see [`e2e/README.md`](e2e/README.md).

## The four categories

| Category | What it tests | May fake | Speed | Runs in CI |
| --- | --- | --- | --- | --- |
| **Unit** | Individual modules/components in isolation ([Vitest](https://vitest.dev/), `happy-dom`) | Anything — mocks encouraged | Seconds | Every PR |
| **Integration** | Multiple main-process modules against real subprocesses/disk (Vitest, `node`, serial) | External services | Tens of seconds | Every PR |
| **E2E** | The real built app driven by [Playwright](https://playwright.dev/), per platform | Synthetic state via dev hooks; may assert on IPC dispatch instead of real side effects | Minutes | Every PR (`@windows` / `@macos` / `@linux`) |
| **Lifecycle** | Full user flows with **zero mocking**: real clicks, real downloads, real git, real disk | Nothing during app execution (staging fixtures and stubbed native OS dialogs only) | Up to hours (~500 MB real install) | Nightly + manual (`lifecycle.yml`) |

Where they live:

- Unit: `src/**/*.test.ts` (excluding `*.integration.test.ts`)
- Integration: `src/**/*.integration.test.ts`
- E2E + Lifecycle: `e2e/*.test.ts`, selected by tag in the test title
  (`@windows @macos @linux` vs `@lifecycle`), mapped to Playwright projects in
  `playwright.config.ts`

## Running tests

```bash
# Unit
pnpm test                    # run once
pnpm run test:watch          # watch mode
pnpm exec vitest run src/main/lib/desktopDetect.test.ts   # one file

# Integration
pnpm run test:integration

# E2E (build first — Playwright drives the built app)
pnpm run build
pnpm run test:e2e:windows    # or :macos / :linux
pnpm exec playwright test --project=windows chooser.test.ts   # one spec

# Lifecycle (real installs/downloads — see warning below)
pnpm run build
pnpm run test:e2e:lifecycle
pnpm exec playwright test --project=lifecycle lifecycle-copy.test.ts   # one spec
```

> [!WARNING]
> `pnpm run test:e2e` with no `--project` runs **all** projects, including
> `lifecycle` — which downloads ~500 MB and performs real installs. Use the
> per-platform or per-project scripts unless that is what you want.

The lifecycle harness prints the per-run profile directory
(`[lifecycle-harness] fresh profile dir: …`); re-export it as
`LIFECYCLE_REUSE_DIR` to re-run individual tests against that profile.

## Which category does my test belong in?

- Testing a function, composable, or component contract → **unit**.
- Testing several main-process modules working together against real
  subprocesses or the filesystem → **integration**.
- Driving the built app's UI, but seeding synthetic state via dev hooks
  (`seedRunningSession`, `setAppUpdateState`, …) or asserting that an IPC was
  dispatched → **E2E**, tagged `@windows @macos @linux`.
- Validating a complete user flow the way a human release tester would — real
  clicks on real controls, real downloads, real side effects on disk →
  **lifecycle**, tagged `@lifecycle`. The flow under test must be triggered
  through the real UI control, never by calling `window.api` directly; a broken
  button must fail the test. See the policy in
  [`e2e/README.md`](e2e/README.md#zero-mock-policy-lifecycle-tests) before
  writing one.

## Before every commit

```bash
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test
```

Typecheck and lint are enforced by a husky pre-commit hook. Flaky tests are not
acceptable — fix them when discovered (see [`AGENTS.md`](AGENTS.md)).

## CI mapping

| Workflow | Trigger | What runs |
| --- | --- | --- |
| `ci.yml` | Every PR | Unit + integration on Linux; E2E per platform (`test:e2e:macos` / `:windows` / `:linux`) |
| `lifecycle.yml` | Nightly + manual dispatch | The whole `lifecycle` Playwright project |

Playwright traces, videos, and screenshots for failures are uploaded as CI
artifacts (`playwright-report/`, `test-results/`).
