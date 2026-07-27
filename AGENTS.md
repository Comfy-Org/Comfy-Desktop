# Agent Guidelines

Keep this file lean. Frontier models need outcomes, constraints, and project facts they can't infer from the code — not step-by-step workflow instructions. Personal workflow preferences belong in your own local config, not here.

ComfyUI Desktop is an Electron app (electron-vite, Vue 3, TypeScript, pnpm) that installs and manages a local ComfyUI.

## Checks

CI is the gate: every PR runs lint, typecheck, unit, integration, and per-platform e2e; lifecycle tests run nightly. Locally, run the checks that cover your change (e.g. `pnpm exec vitest run <file>`, `pnpm run typecheck`) rather than the full suite. A husky pre-commit hook enforces typecheck and lint.

- Failures surfaced by any check are ours to fix, even if pre-existing. Don't bypass them (`--no-verify`, skipping tests, weakening assertions).
- Flaky tests are not acceptable — fix them when discovered rather than retrying around them.
- `pnpm run test:e2e` without `--project` also runs the `lifecycle` project, which downloads ~500 MB and performs a real install. Use the `test:e2e:<platform>` scripts. See [TESTING.md](TESTING.md) for the test taxonomy.

## Git

On feature branches (anything other than `main`), commit and push as you go without asking. Do not push to `main`, force-push, or rewrite published history without explicit user instruction.

## Comments

Comments describe the code as it is now. Never reference plan steps, phases, or track/stage IDs ("Phase 3 §17", "Track M-7") and don't narrate history — plans change, and the git log carries the past.

## ComfyUI-Manager is v4 (not the legacy v3 layout)

Installs launched by this app run **Manager v4**: the `comfyui_manager` Python package inside the standalone env, enabled through ComfyUI's `--enable-manager` flag. Do not reason about Manager from the v3 codebase.

- **Source of truth: the `manager-v4` branch** of Comfy-Org/ComfyUI-Manager. The `main` branch (legacy `glob/manager_server.py` layout) does NOT describe what desktop ships - reading it gives wrong answers about security gates, endpoints, and config. A workspace checkout of ComfyUI-Manager is typically on `main`; use `git show origin/manager-v4:<path>` or check out the branch.
- **Per-install config** lives at `<install>/ComfyUI/user/__manager/config.ini`, `[default]` section. The launcher reconciles per-install settings into it on launch (see `src/main/lib/managerConfig.ts`).
- **v4 security model** (differs from v3):
  - Risk levels are subdivided: `block` / `high+` / `high` / `middle+` / `middle`.
  - `network_mode` accepts `public | private | offline | personal_cloud`.
  - With a non-loopback `--listen`, `middle+` actions (e.g. installing node packs) are denied at EVERY `security_level` unless `network_mode = personal_cloud`; `high+` additionally requires `security_level = weak`.
  - `allow_git_url_install` / `allow_pip_install` are independent config flags, gated by the same network-position rule.
- **API is v2**: endpoints live under `/api/v2/...` (e.g. the lifecycle test probes `POST /api/v2/snapshot/remove`).
