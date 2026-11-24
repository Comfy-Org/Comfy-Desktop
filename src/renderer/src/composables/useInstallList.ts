import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatRelativeFromMs } from '../lib/datetime'
import { lastUsedAt } from '../../../shared/lastUsed'
import { scoreName } from '../utils/fuzzyMatch'
import type { Installation } from '../types/ipc'

export type FilterKey = 'all' | 'local' | 'cloud' | 'remote'

export interface FilterChip {
  key: FilterKey
  labelKey: string
}

export const FILTER_CHIPS: readonly FilterChip[] = [
  { key: 'all', labelKey: 'chooser.filterAll' },
  { key: 'local', labelKey: 'chooser.filterLocal' },
  { key: 'cloud', labelKey: 'chooser.filterCloud' },
  { key: 'remote', labelKey: 'chooser.filterRemote' }
]

export interface UseInstallListOpts {
  installations: Ref<Installation[]>
}

export interface UseInstallListApi {
  searchQuery: Ref<string>
  activeFilter: Ref<FilterKey>
  effectiveInstalls: ComputedRef<Installation[]>
  visibleInstalls: ComputedRef<Installation[]>
  showEmptyHint: ComputedRef<boolean>
  matchesQuery: (name: string) => boolean
  lastLaunchedShortLabel: (inst: Installation) => string
}

export function useInstallList(opts: UseInstallListOpts): UseInstallListApi {
  const { installations } = opts

  const { t } = useI18n()
  const searchQuery = ref('')
  const activeFilter = ref<FilterKey>('all')
  const hideCloudFromPicker = ref<boolean>(false)

  function matchesQuery(name: string): boolean {
    const q = searchQuery.value.trim().toLowerCase()
    if (!q) return true
    return scoreName(q, name.toLowerCase()) > 0
  }

  function sortByRecency(a: Installation, b: Installation): number {
    return (lastUsedAt(b) ?? -Infinity) - (lastUsedAt(a) ?? -Infinity)
  }

  const effectiveInstalls = computed<Installation[]>(() =>
    hideCloudFromPicker.value
      ? installations.value.filter((i) => i.sourceCategory !== 'cloud')
      : installations.value
  )

  const visibleInstalls = computed<Installation[]>(() => {
    const sorted = [...effectiveInstalls.value].sort(sortByRecency)
    const byCategory = (() => {
      switch (activeFilter.value) {
        case 'all':
          return sorted
        case 'local':
          return sorted.filter((i) => i.sourceCategory === 'local')
        case 'remote':
          return sorted.filter((i) => i.sourceCategory === 'remote')
        case 'cloud':
          return sorted.filter((i) => i.sourceCategory === 'cloud')
        default:
          return sorted
      }
    })()
    return byCategory.filter((i) => matchesQuery(i.name))
  })

  const showEmptyHint = computed<boolean>(
    () => !!searchQuery.value.trim() && visibleInstalls.value.length === 0
  )

  const now = ref(Date.now())
  let nowTimer: ReturnType<typeof setInterval> | null = null
  let unsubSettingsChanged: (() => void) | null = null

  const refetchHideCloud = async (): Promise<void> => {
    try {
      const value = await window.api.getSetting('hideCloudFromPicker')
      hideCloudFromPicker.value = value === true
    } catch {
      hideCloudFromPicker.value = false
    }
  }

  onMounted(() => {
    nowTimer = setInterval(() => {
      now.value = Date.now()
    }, 60_000)
    void refetchHideCloud()
    try {
      unsubSettingsChanged = window.api.onSettingsChanged((data) => {
        if (data?.key === 'hideCloudFromPicker') void refetchHideCloud()
      })
    } catch {}
  })
  onBeforeUnmount(() => {
    if (nowTimer) clearInterval(nowTimer)
    if (unsubSettingsChanged) unsubSettingsChanged()
  })

  function lastLaunchedShortLabel(inst: Installation): string {
    const usedAt = lastUsedAt(inst)
    return usedAt === undefined ? '' : formatRelativeFromMs(usedAt, t, now.value)
  }

  return {
    searchQuery,
    activeFilter,
    effectiveInstalls,
    visibleInstalls,
    showEmptyHint,
    matchesQuery,
    lastLaunchedShortLabel
  }
}
