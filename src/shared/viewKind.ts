/**
 * Instance-navigation vocabulary shared across main / preload / renderer.
 *   - `ViewKind` — what a host window shows: dashboard, local instance, or cloud
 *     (a `remote` host presents as `cloud`).
 *   - `Category` — the raw `sourceCategory` on an install, kept verbatim.
 *   - `NavClass` — the class a `Category` collapses to for navigation
 *     (`remote` ⇒ `cloud`).
 */
export type ViewKind = 'dashboard' | 'instance' | 'cloud'
export type Category = 'local' | 'cloud' | 'remote'
export type NavClass = 'local' | 'cloud'

const VALID_CATEGORY: ReadonlySet<Category> = new Set<Category>(['local', 'cloud', 'remote'])

/** Collapse a raw source category to its navigation class (`remote` ⇒ `cloud`). */
export function navClass(category: Category): NavClass {
  return category === 'local' ? 'local' : 'cloud'
}

/**
 * Classify a host's view-kind from its active install:
 *   - no active install → `'dashboard'`
 *   - local install     → `'instance'`
 *   - cloud|remote (or unknown category on an install-backed host) → `'cloud'`
 */
export function viewKindFor(activeInstallationId: string | null, category: Category | null): ViewKind {
  if (activeInstallationId === null) return 'dashboard'
  return category === 'local' ? 'instance' : 'cloud'
}

/** Coerce an unknown `sourceCategory` payload to a `Category`, or `null` when
 *  absent/unrecognised (install-less hosts have no category). */
export function normaliseCategory(raw: unknown): Category | null {
  return typeof raw === 'string' && VALID_CATEGORY.has(raw as Category) ? (raw as Category) : null
}
