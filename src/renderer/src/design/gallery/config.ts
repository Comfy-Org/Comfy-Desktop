/**
 * Where this codebase keeps its design system. The only project-specific
 * file: point these at another Tailwind v4 codebase and the gallery's
 * tokens, usage counts and llm.txt paths follow.
 *
 * `import.meta.glob` needs literal patterns, so they live here.
 */

/** CSS files with `@theme { … }` blocks: the tokens. */
export const THEME_SOURCES = import.meta.glob('../landing/ui/tokens.css', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** Code that uses the tokens, for usage counts and code context. */
export const CODE_SOURCES = import.meta.glob('../landing/**/*.{vue,ts,tsx,jsx,css}', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>
/** The glob keys' common prefix, stripped for display. */
export const CODE_PREFIX = '../landing/'

/** The same folder from the repo root, for instructions to agents. */
export const REPO_ROOT = 'src/renderer/src/design/landing'
/** The main theme file from the repo root. */
export const THEME_FILE = `${REPO_ROOT}/ui/tokens.css`
/** The kit (shared components) inside REPO_ROOT. */
export const KIT_DIR = 'ui'

/** All theme CSS as one string (declarations and their comments). */
export const THEME_TEXT = Object.values(THEME_SOURCES).join('\n')
