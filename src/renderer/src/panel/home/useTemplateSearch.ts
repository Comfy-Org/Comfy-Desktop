import { computed, onScopeDispose, ref, watch } from 'vue'
import type { TemplateSearchResult } from '../../types/ipc'
import {
  WEAK_MATCH_FLOOR,
  searchRows,
  type SearchRow,
  type TemplateSearchClient
} from './templateSearch'

export const SEARCH_DELAY_MS = 300

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string }
  | { kind: 'result'; query: string; result: TemplateSearchResult }
  | { kind: 'failed'; query: string }

export interface TemplateSearchOptions {
  client: () => TemplateSearchClient
  blockedReason: () => string | null
  refreshKey: () => string
  weakMatchFloor?: () => number
}

export function useTemplateSearch(options: TemplateSearchOptions) {
  const query = ref('')
  const state = ref<SearchState>({ kind: 'idle' })
  const panelOpen = ref(false)
  const activeIndex = ref(0)
  const openFailed = ref(false)
  let latestRequest = 0
  let pendingSearch: ReturnType<typeof setTimeout> | undefined

  const rows = computed<SearchRow[]>(() =>
    state.value.kind === 'result'
      ? searchRows(state.value.result, options.weakMatchFloor?.() ?? WEAK_MATCH_FLOOR)
      : []
  )
  const reply = computed(() => (state.value.kind === 'result' ? state.value.result.reply : null))
  const activeRow = computed(() => rows.value[activeIndex.value] ?? null)
  const hasAnswer = computed(() => state.value.kind !== 'idle')

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
    panelOpen.value = true
    openFailed.value = false
    const response = await options
      .client()
      .search(trimmed)
      .catch(() => null)
    if (request !== latestRequest) return
    activeIndex.value = 0
    state.value =
      response?.kind === 'result'
        ? { kind: 'result', query: trimmed, result: response.result }
        : { kind: 'failed', query: trimmed }
  }

  watch(query, (text) => {
    cancelPendingSearch()
    if (!text.trim()) {
      latestRequest++
      state.value = { kind: 'idle' }
      return
    }
    pendingSearch = setTimeout(() => void search(text), SEARCH_DELAY_MS)
  })

  watch(options.refreshKey, () => {
    if (query.value.trim()) void search(query.value)
  })

  onScopeDispose(cancelPendingSearch)

  function isCurrent(): boolean {
    return state.value.kind === 'result' && state.value.query === query.value.trim()
  }

  function rowDisabled(row: SearchRow): boolean {
    return row.kind === 'agent' || options.blockedReason() !== null
  }

  async function openRow(row: SearchRow): Promise<void> {
    if (rowDisabled(row) || !row.candidate || row.kind === 'agent') return
    const pick = {
      query: state.value.kind === 'result' ? state.value.query : query.value.trim(),
      kind: row.kind,
      position: rows.value.indexOf(row),
      best: row.best
    }
    const opened = await options
      .client()
      .open(row.candidate, pick)
      .catch(() => false)
    openFailed.value = !opened
    if (opened) panelOpen.value = false
  }

  function onEnter(): void {
    const row = activeRow.value
    if (isCurrent() && row && !rowDisabled(row)) {
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
    hasAnswer,
    blockedReason: computed(options.blockedReason),
    search,
    openRow,
    onEnter,
    move,
    highlight,
    rowDisabled
  }
}

export type TemplateSearchController = ReturnType<typeof useTemplateSearch>
