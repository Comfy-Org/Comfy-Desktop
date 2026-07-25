# Agent Guidelines

## Pre-commit checks

Run typecheck, lint, build, and tests before every commit and push:

```sh
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test
```

Typecheck and lint are enforced automatically by a husky pre-commit hook.

## Committing and pushing

When the current branch is a working / feature branch (anything other than `main`), it is fine to `git commit` and `git push` without asking for explicit confirmation each time — keep the branch up to date as you make progress. Run the pre-commit checks above first, fix everything they surface, and only then commit + push.

Do **not** push directly to `main`, force-push (`--force` / `--force-with-lease`), or rewrite already-published history without explicit user instruction.

## Fix all issues found by checks

Any errors or warnings surfaced by typecheck, lint, audit, or tests are **our responsibility to fix** — even if they appear to be pre-existing. Do not skip, ignore, or work around them with `--no-verify`. If a pre-commit hook fails, fix the underlying issues before committing.

## Flaky tests

Flaky tests are **not acceptable** — they must be fixed immediately when discovered. A test that intermittently fails erodes CI trust and masks real regressions. Common causes:

- **Timing assertions** (e.g., `expect(elapsed).toBeLessThan(X)`) — use generous thresholds or assert behavior instead of timing.
- **Process lifecycle races** — add explicit readiness signals (e.g., IPC `ready` messages) instead of relying on timing.
- **Platform-specific quirks** — Windows `taskkill` and PowerShell Restart Manager can be slow; account for this in timeouts and assertions.

If you encounter a flaky test during a run, investigate and fix it before continuing with other work.

## Comments

- **Be concise.** Don't write multi-paragraph comments to justify a small change. One sentence beats five.
- **Never reference plan steps, phases, tracks, or stage IDs** (e.g. "Phase 3 §17", "Track M-7", "Stage W-4"). Plans change; the comment becomes a lie within hours and meaningless once the feature ships. Describe what the code does, not what plan brought it here.
- **Don't narrate history** ("This used to do X, now it does Y"). The git log carries that.

## Follow instructions

When the user gives explicit direction (e.g., "move away from takeovers", "use the unified primitive"), apply it everywhere — search the whole codebase for remaining offenders. **Never silently defer or skip part of an instruction without asking.** If something looks risky, ask; don't decide unilaterally to leave it for later.

## Post-change review: code review after every big piece

After completing any substantial piece of work (a new feature, a test-suite change, a refactor spanning multiple files), do a dedicated code review pass before moving on:

- Review the full diff (`git diff` against the merge base), not just the files you remember touching.
- Check that CI-relevant checks (typecheck, lint, build, tests) pass AND that their passing is meaningful — no weakened assertions, skipped tests, or reduced coverage.
- Verify code coverage did not decrease compared to the base branch.
- Use an independent reviewer (e.g. the oracle) for changes with subtle correctness risk.

## Post-change review: deduplication

After creating or modifying code, check for duplicated logic before committing:

- Look for repeated filter predicates, conditions, or expressions that could be extracted into a shared variable, computed property, or helper.
- If two call sites must stay in sync (e.g., a visibility check and the action it guards), extract the shared logic so they cannot diverge.

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
