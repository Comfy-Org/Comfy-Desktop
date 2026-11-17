import { computed, onScopeDispose, ref, watch } from 'vue'
import type { TemplateSearchAvailability, TemplateSearchResult } from '../../types/ipc'
import { searchRows, type SearchRow } from './templateSearch'

export const SEARCH_DELAY_MS = 300

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string }
  | { kind: 'result'; query: string; result: TemplateSearchResult }
  | { kind: 'unavailable'; query: string; availability: TemplateSearchAvailability }
  | { kind: 'failed'; query: string }

const READY_AGAIN: ReadonlySet<TemplateSearchAvailability['kind']> = new Set(['idle', 'ready'])

export interface TemplateSearchOptions {
  buildId: () => string | null
  onOpened: () => void
}

export function useTemplateSearch(options: TemplateSearchOptions) {
  const query = ref('')
  const state = ref<SearchState>({ kind: 'idle' })
  const panelOpen = ref(false)
  const activeIndex = ref(0)
  const openFailed = ref(false)
  let latestRequest = 0
  let prepared = false
  let pendingSearch: ReturnType<typeof setTimeout> | undefined

  const rows = computed<SearchRow[]>(() =>
    state.value.kind === 'result' ? searchRows(state.value.result) : []
  )
  const reply = computed(() => (state.value.kind === 'result' ? state.value.result.reply : null))
  const activeRow = computed(() => rows.value[activeIndex.value] ?? null)

  function cancelPendingSearch(): void {
    if (pendingSearch !== undefined) clearTimeout(pendingSearch)
    pendingSearch = undefined
  }

  async function search(text: string): Promise<void> {
    cancelPendingSearch()
    const trimmed = text.trim()
    if (!trimmed) {
      state.value = { kind: 'idle' }
      return
    }
    const request = ++latestRequest
    state.value = { kind: 'searching', query: trimmed }
    openFailed.value = false
    const response = await window.api
      .searchTemplates(trimmed, options.buildId() ?? '')
      .catch(() => null)
    if (request !== latestRequest) return
    activeIndex.value = 0
    if (response?.kind === 'result') {
      state.value = { kind: 'result', query: trimmed, result: response.result }
    } else if (response?.kind === 'unavailable') {
      state.value = { kind: 'unavailable', query: trimmed, availability: response.availability }
    } else {
      state.value = { kind: 'failed', query: trimmed }
    }
  }

  function onAvailability(availability: TemplateSearchAvailability): void {
    const current = state.value
    if (current.kind !== 'unavailable') return
    if (READY_AGAIN.has(availability.kind)) void search(current.query)
    else state.value = { ...current, availability }
  }

  const unsubscribe = window.api.onTemplateSearchAvailability(onAvailability)

  watch(query, (text) => {
    cancelPendingSearch()
    if (!text.trim()) {
      latestRequest++
      state.value = { kind: 'idle' }
      return
    }
    pendingSearch = setTimeout(() => void search(text), SEARCH_DELAY_MS)
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
    const opened = outcome === 'opened' || outcome === 'launch'
    openFailed.value = !opened
    if (!opened) return
    panelOpen.value = false
    options.onOpened()
  }

  function onEnter(): void {
    panelOpen.value = true
    const row = activeRow.value
    if (isCurrent() && row) {
      void openRow(row)
      return
    }
    void search(query.value)
  }

  function highlight(index: number): void {
    activeIndex.value = index
  }

  function move(step: number): void {
    if (!rows.value.length) return
    panelOpen.value = true
    activeIndex.value = (activeIndex.value + step + rows.value.length) % rows.value.length
  }

  return {
    query,
    state,
    rows,
    reply,
    panelOpen,
    activeIndex,
    activeRow,
    openFailed,
    search,
    prepare,
    download,
    openRow,
    onEnter,
    move,
    highlight
  }
}

export type TemplateSearchController = ReturnType<typeof useTemplateSearch>
