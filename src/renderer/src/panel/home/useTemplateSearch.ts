import { computed, onScopeDispose, ref, watch } from 'vue'
import type { TemplateSearchAvailability, TemplateSearchResult } from '../../types/ipc'
import { searchRows, type SearchRow } from './templateSearch'

export const SEARCH_DELAY_MS = 300
const PARTNERS_SETTING = 'templateSearchPartners'

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'result'; query: string; result: TemplateSearchResult }
  | { kind: 'unavailable'; availability: TemplateSearchAvailability }
  | { kind: 'failed' }

const READY_AGAIN: ReadonlySet<TemplateSearchAvailability['kind']> = new Set(['idle', 'ready'])

export interface TemplateSearchOptions {
  buildId: () => string | null
  onOpened: (buildId: string) => void
  signedOut: () => boolean
  signIn: () => void
}

export function useTemplateSearch(options: TemplateSearchOptions) {
  const query = ref('')
  const state = ref<SearchState>({ kind: 'idle' })
  const panelOpen = ref(false)
  const activeIndex = ref(0)
  const inResults = ref(false)
  const openFailed = ref(false)
  let latestRequest = 0
  let prepared = false
  let pendingSearch: ReturnType<typeof setTimeout> | undefined

  const partnerSwitch = computed(
    () => state.value.kind === 'result' && state.value.result.partnerSwitch
  )
  const partnersShown = computed(
    () => state.value.kind !== 'result' || state.value.result.partnersShown
  )
  const rows = computed<SearchRow[]>(() =>
    state.value.kind === 'result' ? searchRows(state.value.result) : []
  )
  const reply = computed(() => (state.value.kind === 'result' ? state.value.result.reply : null))
  const activeRow = computed(() => rows.value[activeIndex.value] ?? null)

  function cancelPendingSearch(): void {
    if (pendingSearch !== undefined) clearTimeout(pendingSearch)
    pendingSearch = undefined
  }

  function forgetAnswer(): void {
    latestRequest++
    cancelPendingSearch()
    state.value = { kind: 'idle' }
  }

  async function search(text: string): Promise<void> {
    cancelPendingSearch()
    const trimmed = text.trim()
    if (!trimmed) {
      state.value = { kind: 'idle' }
      return
    }
    const request = ++latestRequest
    state.value = { kind: 'searching' }
    openFailed.value = false
    const response = await window.api
      .searchTemplates(trimmed, options.buildId() ?? '')
      .catch(() => null)
    if (request !== latestRequest) return
    if (response?.kind === 'result') {
      state.value = { kind: 'result', query: trimmed, result: response.result }
      activeIndex.value = Math.max(
        0,
        rows.value.findIndex((row) => row.best)
      )
    } else if (response?.kind === 'unavailable') {
      state.value = { kind: 'unavailable', availability: response.availability }
    } else {
      state.value = { kind: 'failed' }
    }
  }

  function onAvailability(availability: TemplateSearchAvailability): void {
    const current = state.value
    if (current.kind !== 'unavailable') return
    if (READY_AGAIN.has(availability.kind)) void search(query.value)
    else state.value = { ...current, availability }
  }

  const unsubscribe = window.api.onTemplateSearchAvailability(onAvailability)

  function leaveResults(): void {
    inResults.value = false
  }

  watch(panelOpen, (open) => {
    if (!open) leaveResults()
  })

  watch(query, (text) => {
    leaveResults()
    cancelPendingSearch()
    if (!text.trim()) {
      forgetAnswer()
      return
    }
    pendingSearch = setTimeout(() => void search(text), SEARCH_DELAY_MS)
  })

  watch(options.buildId, () => {
    if (!query.value.trim() || state.value.kind === 'idle') return
    if (panelOpen.value) void search(query.value)
    else forgetAnswer()
  })

  onScopeDispose(() => {
    cancelPendingSearch()
    unsubscribe()
  })

  function prepare(): void {
    if (prepared) return
    prepared = true
    void window.api.prepareTemplateSearch().catch(() => null)
  }

  onScopeDispose(
    window.api.onSettingsChanged(({ key }) => {
      if (key !== PARTNERS_SETTING || !query.value.trim()) return
      if (panelOpen.value) void search(query.value)
      else forgetAnswer()
    })
  )

  async function setPartnersShown(shown: boolean): Promise<void> {
    await window.api.setSetting(PARTNERS_SETTING, shown).catch(() => null)
  }

  function download(): void {
    void window.api.downloadTemplateSearch().catch(() => null)
  }

  function isCurrent(): boolean {
    return state.value.kind === 'result' && state.value.query === query.value.trim()
  }

  async function openRow(row: SearchRow): Promise<void> {
    const buildId = options.buildId()
    const outcome = buildId
      ? await window.api.openTemplateInBuild(buildId, row.candidate.templateId).catch(() => null)
      : null
    if (!buildId || (outcome !== 'opened' && outcome !== 'launch')) {
      openFailed.value = true
      return
    }
    openFailed.value = false
    panelOpen.value = false
    options.onOpened(buildId)
  }

  function open(): void {
    panelOpen.value = true
    if (query.value.trim() && state.value.kind === 'idle') void search(query.value)
  }

  function needsSignIn(row: SearchRow): boolean {
    return row.candidate.partner && options.signedOut()
  }

  function activate(row: SearchRow): void {
    if (needsSignIn(row)) options.signIn()
    else void openRow(row)
  }

  function onEnter(): void {
    const wasOpen = panelOpen.value
    panelOpen.value = true
    if (isCurrent()) {
      const row = activeRow.value
      if (wasOpen && row) activate(row)
      return
    }
    void search(query.value)
  }

  function highlight(index: number): void {
    activeIndex.value = index
  }

  function moveTo(index: number): void {
    panelOpen.value = true
    inResults.value = true
    activeIndex.value = index
  }

  function move(step: number): void {
    if (!rows.value.length) {
      if (state.value.kind === 'idle') open()
      return
    }
    moveTo((activeIndex.value + step + rows.value.length) % rows.value.length)
  }

  return {
    query,
    state,
    rows,
    reply,
    panelOpen,
    activeIndex,
    activeRow,
    inResults,
    openFailed,
    partnerSwitch,
    partnersShown,
    setPartnersShown,
    prepare,
    open,
    download,
    needsSignIn,
    activate,
    onEnter,
    move,
    moveTo,
    leaveResults,
    highlight
  }
}

export type TemplateSearchController = ReturnType<typeof useTemplateSearch>
