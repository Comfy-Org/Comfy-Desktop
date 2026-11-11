<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bot, LoaderCircle, Search } from 'lucide-vue-next'
import type { TemplateSearchCandidate, TemplateSearchResult } from '../../types/ipc'
import { searchRows, type SearchRow, type TemplateSearchClient } from './templateSearch'

const SEARCH_DELAY_MS = 300

const props = withDefaults(
  defineProps<{ client: TemplateSearchClient; blockedReason?: string | null }>(),
  { blockedReason: null }
)

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string }
  | { kind: 'result'; query: string; result: TemplateSearchResult }
  | { kind: 'failed'; query: string }

const { t } = useI18n()
const listboxId = useId()
const query = ref('')
const state = ref<SearchState>({ kind: 'idle' })
const open = ref(false)
const activeIndex = ref(0)
const openFailed = ref(false)
let latestRequest = 0
let pendingSearch: ReturnType<typeof setTimeout> | undefined

const rows = computed<SearchRow[]>(() =>
  state.value.kind === 'result' ? searchRows(state.value.result) : []
)
const reply = computed(() => (state.value.kind === 'result' ? state.value.result.reply : null))
const showPanel = computed(() => open.value && state.value.kind !== 'idle')
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
  open.value = true
  openFailed.value = false
  const response = await props.client.search(trimmed).catch(() => null)
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

onBeforeUnmount(cancelPendingSearch)

function isCurrent(): boolean {
  return state.value.kind === 'result' && state.value.query === query.value.trim()
}

function rowDisabled(row: SearchRow): boolean {
  return row.kind === 'agent' || props.blockedReason !== null
}

async function openRow(row: SearchRow): Promise<void> {
  if (rowDisabled(row) || !row.candidate || row.kind === 'agent') return
  const pick = {
    query: state.value.kind === 'result' ? state.value.query : query.value.trim(),
    kind: row.kind,
    position: rows.value.indexOf(row),
    best: row.best
  }
  const opened = await props.client.open(row.candidate, pick).catch(() => false)
  openFailed.value = !opened
  if (opened) open.value = false
}

function onEnter(): void {
  const row = activeRow.value
  if (isCurrent() && row && !rowDisabled(row)) {
    void openRow(row)
    return
  }
  void search(query.value)
}

function move(step: number): void {
  if (!rows.value.length) return
  open.value = true
  activeIndex.value = (activeIndex.value + step + rows.value.length) % rows.value.length
}

function close(): void {
  open.value = false
}

function rowMeta(row: SearchRow): string {
  if (row.kind === 'agent') return t('home.search.agentSoon')
  if (props.blockedReason !== null) return props.blockedReason
  const candidate = row.candidate as TemplateSearchCandidate
  if (row.kind === 'run') return t('home.search.template')
  return candidate.missing.length
    ? t('home.search.needsDownload', { items: candidate.missing.join(', ') })
    : t('home.search.needsTemplateDownload')
}

function rowAction(row: SearchRow): string {
  if (row.kind === 'agent') return t('home.search.askAgent')
  return row.kind === 'download' ? t('home.search.downloadAndRun') : t('home.search.run')
}

function groupTitle(row: SearchRow): string {
  if (row.kind === 'agent') return t('home.search.agentGroup')
  return row.kind === 'download' ? t('home.search.downloadAndRun') : t('home.search.run')
}

function startsGroup(index: number): boolean {
  return index === 0 || rows.value[index - 1]!.kind !== rows.value[index]!.kind
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null
  if (!(event.currentTarget as HTMLElement).contains(next)) close()
}
</script>

<template>
  <div
    class="relative mx-auto w-full max-w-180"
    data-testid="home-template-search"
    @focusout="onFocusOut"
    @keydown.esc="close"
  >
    <label
      class="flex h-12 items-center gap-2.5 rounded-2xl border border-[rgb(137_137_137/0.16)] bg-[rgb(137_137_137/0.06)] px-4 shadow-[0_8px_30px_-12px_rgb(0_0_0/0.5)] transition-colors focus-within:border-[rgb(137_137_137/0.32)] focus-within:bg-[rgb(137_137_137/0.09)]"
    >
      <LoaderCircle
        v-if="state.kind === 'searching'"
        :size="16"
        class="shrink-0 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <Search v-else :size="16" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        v-model="query"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        class="h-full min-w-0 flex-auto bg-transparent text-[14px] text-foreground outline-none placeholder:text-subtle-foreground"
        :aria-label="t('home.search.label')"
        :placeholder="t('home.search.placeholder')"
        :aria-expanded="showPanel"
        :aria-controls="listboxId"
        :aria-activedescendant="showPanel && activeRow ? `${listboxId}-${activeIndex}` : undefined"
        data-testid="home-template-search-input"
        @focus="open = true"
        @keydown.enter.prevent="onEnter"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
      />
    </label>

    <div
      v-if="showPanel"
      class="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-[rgb(137_137_137/0.16)] bg-content-background p-2 shadow-[0_32px_80px_-24px_rgb(0_0_0/0.75)]"
      data-testid="home-template-search-results"
    >
      <p
        v-if="state.kind === 'searching' && !rows.length"
        class="m-0 px-2.5 py-2 text-[13px]/5 text-muted-foreground"
      >
        {{ t('home.search.searching') }}
      </p>
      <p
        v-else-if="state.kind === 'failed'"
        class="m-0 px-2.5 py-2 text-[13px]/5 text-muted-foreground"
        data-testid="home-template-search-failed"
      >
        {{ t('home.search.failed') }}
      </p>
      <template v-else>
        <p
          v-if="reply"
          class="m-0 px-2.5 py-2 text-[13px]/5 text-foreground"
          data-testid="home-template-search-reply"
        >
          {{ reply }}
        </p>
        <p v-else-if="!rows.length" class="m-0 px-2.5 py-2 text-[13px]/5 text-muted-foreground">
          {{ t('home.search.noMatch') }}
        </p>
      </template>
      <ul
        :id="listboxId"
        role="listbox"
        class="m-0 list-none p-0"
        :aria-label="t('home.search.label')"
      >
        <template v-for="(row, index) in rows" :key="row.key">
          <li
            v-if="startsGroup(index)"
            role="presentation"
            class="px-2.5 pt-2 pb-1 text-[11px]/4 font-medium tracking-[0.09em] text-subtle-foreground uppercase"
          >
            {{ groupTitle(row) }}
          </li>
          <li
            :id="`${listboxId}-${index}`"
            role="option"
            :aria-selected="index === activeIndex"
            :aria-disabled="rowDisabled(row)"
            class="flex h-14 items-center gap-3 rounded-[8px] px-2.5"
            :class="[
              index === activeIndex ? 'bg-[rgb(137_137_137/0.12)]' : '',
              rowDisabled(row) ? 'cursor-default opacity-60' : 'cursor-pointer'
            ]"
            :data-testid="`home-template-search-row-${row.kind}`"
            @mouseenter="activeIndex = index"
            @mousedown.prevent
            @click="openRow(row)"
          >
            <span
              class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-[rgb(137_137_137/0.12)]"
            >
              <Bot v-if="row.kind === 'agent'" :size="18" class="text-muted-foreground" />
              <img
                v-else-if="row.candidate?.thumbnailUrl"
                :src="row.candidate.thumbnailUrl"
                alt=""
                class="size-full object-cover"
                loading="lazy"
              />
            </span>
            <span class="flex min-w-0 flex-auto flex-col">
              <span class="truncate text-[13px]/5 font-medium text-foreground">
                {{ row.kind === 'agent' ? t('home.search.agentTitle') : row.candidate?.title }}
              </span>
              <span class="truncate text-xs/4 text-subtle-foreground">{{ rowMeta(row) }}</span>
            </span>
            <span
              v-if="row.best"
              class="shrink-0 rounded-full bg-[rgb(137_137_137/0.14)] px-2 py-0.5 text-[11px]/4 text-muted-foreground"
              data-testid="home-template-search-best"
            >
              {{ t('home.search.bestMatch') }}
            </span>
            <span class="shrink-0 text-xs/4 font-medium text-muted-foreground">
              {{ rowAction(row) }}
            </span>
          </li>
        </template>
      </ul>
      <p
        v-if="openFailed"
        class="m-0 px-2.5 pt-1 pb-2 text-xs/4 text-muted-foreground"
        data-testid="home-template-search-open-failed"
      >
        {{ t('home.search.openFailed') }}
      </p>
    </div>
  </div>
</template>
