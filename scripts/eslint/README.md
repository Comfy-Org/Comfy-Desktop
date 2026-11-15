# Canonical Tailwind classes

Renderer Vue and TypeScript files use `eslint-plugin-better-tailwindcss` through
the existing `pnpm run lint`, `pnpm run lint:fix`, and CI Lint job. Its
`enforce-canonical-classes` rule reads `src/renderer/src/assets/main.css`, including
the imported design-system theme, and rejects arbitrary spellings when Tailwind
provides an equivalent utility. For example, `p-[16px]` becomes `p-4`,
`duration-[120ms]` becomes `duration-120`, and `rounded-[14px]` becomes
`rounded-shell`.

The rule assumes the renderer's existing 16px root font size when comparing pixel
values with rem-based spacing. Utility collapsing and logical-property
conversions are disabled. Arbitrary values without an equivalent utility remain
allowed, including custom grid templates, colors, and animation values.

`no-restricted-classes` also prefers the existing theme aliases for legacy color
variables and radius variables. Typography aliases are left alone: the design
system's current class merger treats custom names such as `text-ui/5` as text
colors, and a standalone typography token also supplies a default line height.
Font-family declarations and variable-based font and sizing utilities keep their
original syntax because their normalized forms can change how the same merger
handles component overrides. These exceptions preserve rendering until the
design-system merger supports the newer syntax.

Both rules cover template `class` attributes, `:class` strings and object keys,
component and transition props ending in `-class` or `Class`, and static script
constants ending in `Class`, `Classes`, `ClassName`, `ClassNames`, `_CLASS`,
`_CLASSES`, `_CLASS_NAME`, or `_CLASS_NAMES`. Existing plugin defaults for class
helpers remain enabled. Class ordering and token redesign are outside these
rules.

Run the configuration tests with:

```sh
pnpm exec vitest run --project node scripts/eslint/tailwind-canonical-classes.test.ts
```

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

# No code comments

The local ESLint rule `desktop/no-comments` rejects every comment in linted
files: line, block, and JSDoc comments in TypeScript, JavaScript, and Vue
scripts, and HTML comments anywhere in a Vue SFC. It allows tool directives
that change how a tool behaves: ESLint directives, `@ts-expect-error`,
`@ts-ignore`, `@ts-nocheck`, triple-slash references, `@vitest-environment`,
`prettier-ignore`, coverage ignore hints, `@vite-ignore`, `@__PURE__`, and
shebangs. It also rejects a prose reason after an ESLint directive (`-- why`)
or after `@ts-expect-error`.

The `allowDocComments` option keeps `/** */` doc comments and still rejects
every other comment. `eslint.config.ts` turns it on only for
`publishedApiSpecs`, the files other projects consume as a contract, such as
the bridge types published as `@comfyorg/comfyui-desktop-bridge-types`.

`pnpm run lint:fix` deletes the comment, including its line when the comment
is alone on it, and strips directive reasons. Run Prettier afterwards to tidy
any blank lines left behind. CSS comments inside `<style>` blocks, and comments
in YAML, shell, Python, and other files ESLint does not lint, are outside this
rule.

Run the focused tests with:

```sh
pnpm exec vitest run scripts/eslint/no-comments.test.ts
```
