import { computed, ref, watch } from 'vue'
import { go, proto, type Page } from '../../../../useProto'

export const VARIANTS = [
  { value: 'a', label: 'A · Today' },
  { value: 'e', label: 'E · Compute section' },
  { value: 'f', label: 'F · Compute group, folded' }
] as const
export type Variant = (typeof VARIANTS)[number]['value']

const read = (): Variant => {
  const v = new URLSearchParams(location.search).get('variant')
  return VARIANTS.some((o) => o.value === v) ? (v as Variant) : 'e'
}
export const devVariant = ref<Variant>(read())
export const computeNav = computed(() => devVariant.value !== 'a')
export function pick(v: Variant): void {
  const url = new URL(location.href)
  url.searchParams.set('variant', v)
  history.replaceState(history.state, '', url)
  devVariant.value = v
}

export type ComputeTab = 'builds' | 'deployments' | 'usage' | 'keys'
export const computeTab = ref<ComputeTab>('builds')
export function openCompute(tab: ComputeTab): void {
  computeTab.value = tab
  proto.mode = 'create'
  go('environments')
}

export const SETTINGS_PAGES: Page[] = [
  'people',
  'billing',
  'limits',
  'provider-keys',
  'settings' as Page
]
export const settingsMode = computed(
  () => computeNav.value && SETTINGS_PAGES.includes(proto.page as Page)
)
const lastPage = ref<Page>('overview')
watch(
  () => proto.page,
  (p) => {
    if (!computeNav.value) return
    if (p === 'usage') return openCompute('usage')
    if (p === 'keys') return openCompute('keys')
    if (!SETTINGS_PAGES.includes(p as Page)) lastPage.value = p as Page
  }
)
export function leaveSettings(): void {
  go(lastPage.value)
}
