# Vue component style guardrail

Use Tailwind utilities for component styling. The local ESLint rule
`desktop/no-new-vue-style-blocks` rejects every new top-level Vue SFC `<style>`
block, including scoped, module, empty, and external `src` blocks. It runs in
`pnpm run lint`, `pnpm run lint:fix`, and the existing CI Lint job. It has no
autofix because removing CSS can change the rendered UI.

The Vue ESLint parser identifies blocks, so examples in comments or script
strings do not trigger the rule. Dedicated CSS files, shared theme CSS, and
styles embedded in standalone HTML integration code are outside this rule.

## Existing exceptions

`vue-style-exceptions.json` records the 15 blocks retained by the Tailwind
migration: 13 animation blocks (including the title bar's reduced-motion
override), the chooser's `@property --rows` registration, and the terminal's
unlayered xterm integration overrides. Each entry documents its reason and the
SHA-256 of the complete block, including opening/closing tags and attributes.
Only CRLF line endings are normalized to LF.

An exception permits that exact block once, in that exact repository-relative
file. It does not permit a second block, changes to the existing CSS or its
attributes, or moving/copying the block to another file. Edits elsewhere in the
component and removal of the block are allowed. Removing a block also requires
removing its manifest entry; the tests fail while an entry has no matching
block, so a stale entry cannot silently re-permit that CSS. Do not regenerate
fingerprints to silence lint: any necessary exception change needs deliberate
review of its CSS and reason.

Run the focused tests with:

```sh
pnpm exec vitest run scripts/eslint/no-new-vue-style-blocks.test.ts
```

The tests also run in the normal `pnpm run test` suite. The rule and tests are
included in the Node TypeScript check.
