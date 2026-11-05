# Agent guidelines

## No code comments

This repository does not allow code comments.

- Do not write code comments: no `//` lines, no `/* */` blocks, no JSDoc, and no Vue or HTML `<!-- -->` comments, in source, tests, scripts, or E2E specs.
- Make the code say it with names, extracted functions, types, and tests. In tests, a comment becomes an `it` title, a `test.step` name, an assertion message, or nothing.
- Rationale, history, ticket links, workarounds, and TODOs go in the commit message, the PR description, or an issue.
- Tool directives (`eslint-disable-next-line`, `@ts-expect-error`, `/// <reference>`, `@vitest-environment`, `prettier-ignore`) are allowed. Never append a prose reason to one.
- `desktop/no-comments` in `pnpm run lint` enforces this. `pnpm run lint:fix` deletes offending comments. See `scripts/eslint/README.md`.
