# Agent guidelines

## No code comments

This repository does not allow code comments.

- Do not write code comments: no `//` lines, no `/* */` blocks, no JSDoc, and no Vue or HTML `<!-- -->` comments, in source, tests, scripts, or E2E specs.
- Make the code say it with names, extracted functions, types, and tests. In tests, a comment becomes an `it` title, a `test.step` name, an assertion message, or nothing.
- Rationale, history, ticket links, workarounds, and TODOs go in the commit message, the PR description, or an issue.
- Tool directives (`eslint-disable-next-line`, `@ts-expect-error`, `/// <reference>`, `@vitest-environment`, `prettier-ignore`) are allowed. Never append a prose reason to one.
- Published API specs keep their JSDoc. Files other projects consume as a contract, listed in `publishedApiSpecs` in `eslint.config.ts` (today the bridge contract `src/types/comfyDesktopBridge.ts`), may have `/** */` doc comments. Line comments and plain block comments are still not allowed there.
- `desktop/no-comments` in `pnpm run lint` enforces this. `pnpm run lint:fix` deletes offending comments. See `scripts/eslint/README.md`.

## Pull requests

One pull request answers one question, and stays small enough for a reviewer to hold in their head.

- **One ticket, one pull request.** The body opens with `Fixes DESK-###.` Work that belongs to another ticket goes in its own pull request; say so where it would be missed (`Not changed: Assets' reveal icon (DESK-525).`).
- **Split as soon as it grows.** A pull request that starts answering a second question is split before review, not after. A follow-up that lands on a branch already in review goes to a new branch instead.
- **Branch**: `claude/<topic>-<ticket>`, e.g. `claude/folder-open-vs-browse-574`.
- **Title**: conventional type and scope, then one sentence, in the present tense, about what a person sees — `fix(folders): the folder icon only opens a folder; choosing one is always text`. Not what the code does.
- **Body**, in this order:
  - `## What changes` — what was wrong, what it does now, in prose.
  - `## Before / After` — a screenshot table whenever the change is visible. Screenshots live on the `claude/pr-screenshots` branch under the ticket's folder, linked raw.
  - `## How` — file by file, for the reviewer.
  - `## Tests` — what is new, what changed, what passes.
- **Green before review**: `pnpm run typecheck`, `pnpm run lint`, `pnpm test`.
