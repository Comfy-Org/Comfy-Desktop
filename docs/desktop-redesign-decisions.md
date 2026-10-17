# Desktop redesign: decision log

Product and engineering decisions taken while implementing [the plan](desktop-redesign-plan.md) without a product review. Each entry says what was decided, why, and how to reverse it. Review them; anything marked **Revisit** is a judgement call worth a second opinion.

## Process

| # | Decision | Why |
| --- | --- | --- |
| P1 | The plan is cut from 44 PRs to 19 (M1 5, M2 9, M3 5). Each commit on `PabloWiedemann/desktop-redesign` is one planned PR, in order. | Asked for about half. A PR now covers one surface or one data domain. |
| P2 | Work branches from `origin/main` (last rebased onto `195ae80a`), in a separate worktree. The prototype branch is untouched and still uncommitted. | Start clean; keep the prototype as the visual reference. Push the prototype branch before the team reviews, or the plan's references are not reachable. |
| P3 | Each commit is one pull request, stacked: each PR is based on the one before it, so it shows only its own change. | One reviewable change per PR, merged in order. |
| P4 | E2E tests are not run locally. | On macOS the harness overwrites the real `~/Library/Application Support/comfyui-desktop-2`. They run in CI. |
