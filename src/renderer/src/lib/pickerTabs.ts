export type PickerTab = 'config' | 'status' | 'update' | 'snapshots' | 'storage' | 'console'

export type SectionTab = 'settings' | 'status' | 'update' | 'snapshots' | 'storage' | 'console'

const PICKER_TABS: ReadonlySet<PickerTab> = new Set([
  'config',
  'status',
  'update',
  'snapshots',
  'storage',
  'console'
])

export function isPickerTab(tab: string | null | undefined): tab is PickerTab {
  return tab != null && PICKER_TABS.has(tab as PickerTab)
}

export type InstanceCategory = 'local' | 'cloud' | 'remote'

const HIDDEN_TABS_BY_CATEGORY: Record<InstanceCategory, ReadonlySet<PickerTab>> = {
  local: new Set(),
  cloud: new Set(['console']),
  remote: new Set(['console'])
}

export function isTabAllowedForCategory(tab: PickerTab, category: string | undefined): boolean {
  const hidden = HIDDEN_TABS_BY_CATEGORY[category as InstanceCategory]
  return hidden ? !hidden.has(tab) : true
}

export function resolvePickerTab(tab: string | null | undefined, fallback: PickerTab): PickerTab {
  return isPickerTab(tab) ? tab : fallback
}
