import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'
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

  const searchQuery = ref('')
  const activeFilter = ref<FilterKey>('all')
  const hideCloudFromPicker = ref<boolean>(false)

  function matchesQuery(name: string): boolean {
    const q = searchQuery.value.trim().toLowerCase()
    if (!q) return true
    return scoreName(q, name.toLowerCase()) > 0
  }

  function sortByRecency(a: Installation, b: Installation): number {
    const ta = typeof a.lastLaunchedAt === 'number' ? a.lastLaunchedAt : -Infinity
    const tb = typeof b.lastLaunchedAt === 'number' ? b.lastLaunchedAt : -Infinity
    return tb - ta
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

  function timeAgo(timestamp: number): string {
    const diff = now.value - timestamp
    const minutes = Math.floor(diff / 60_000)
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  function lastLaunchedShortLabel(inst: Installation): string {
    return typeof inst.lastLaunchedAt === 'number' ? timeAgo(inst.lastLaunchedAt) : ''
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
