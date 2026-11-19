export type ViewKind = 'dashboard' | 'instance' | 'cloud'
export type Category = 'local' | 'cloud' | 'remote'
export type NavClass = 'local' | 'cloud'

const VALID_CATEGORY: ReadonlySet<Category> = new Set<Category>(['local', 'cloud', 'remote'])

export function navClass(category: Category): NavClass {
  return category === 'local' ? 'local' : 'cloud'
}

export function viewKindFor(
  activeInstallationId: string | null,
  category: Category | null
): ViewKind {
  if (activeInstallationId === null) return 'dashboard'
  return category === 'local' ? 'instance' : 'cloud'
}

export function normaliseCategory(raw: unknown): Category | null {
  return typeof raw === 'string' && VALID_CATEGORY.has(raw as Category) ? (raw as Category) : null
}
