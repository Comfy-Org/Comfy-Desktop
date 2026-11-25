import { ref, watch } from 'vue'
import { computed } from 'vue'
import { go, proto, type Page } from '../../../../useProto'

export const computeNav = computed(() => true)

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
export const settingsMode = computed(() => SETTINGS_PAGES.includes(proto.page as Page))
const lastPage = ref<Page>('overview')
watch(
  () => proto.page,
  (p) => {
    if (p === 'usage') return openCompute('usage')
    if (p === 'keys') return openCompute('keys')
    if (!SETTINGS_PAGES.includes(p as Page) && p !== 'agent') lastPage.value = p as Page
  }
)
export function leaveSettings(): void {
  go(lastPage.value)
}
