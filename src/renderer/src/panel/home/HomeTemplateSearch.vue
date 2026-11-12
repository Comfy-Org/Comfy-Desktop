<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle, Search } from 'lucide-vue-next'
import TemplateSearchResults from './TemplateSearchResults.vue'
import type { TemplateSearchClient } from './templateSearch'
import { useTemplateSearch, type TemplateSearchController } from './useTemplateSearch'

const UNAVAILABLE_CLIENT: TemplateSearchClient = {
  search: () => Promise.resolve({ kind: 'failed' }),
  open: () => Promise.resolve(false)
}

const props = withDefaults(
  defineProps<{
    client?: TemplateSearchClient
    controller?: TemplateSearchController
    blockedReason?: string | null
    refreshKey?: string
    showResults?: boolean
    listboxId?: string
  }>(),
  {
    client: undefined,
    controller: undefined,
    blockedReason: null,
    refreshKey: '',
    showResults: true,
    listboxId: undefined
  }
)

const { t } = useI18n()
const generatedId = useId()
const listboxId = computed(() => props.listboxId ?? generatedId)
const search =
  props.controller ??
  useTemplateSearch({
    client: () => props.client ?? UNAVAILABLE_CLIENT,
    blockedReason: () => props.blockedReason,
    refreshKey: () => props.refreshKey
  })
const { query, state, panelOpen, activeIndex, activeRow } = search

const showPanel = computed(
  () => props.showResults && panelOpen.value && state.value.kind !== 'idle'
)
const activeDescendant = computed(() =>
  activeRow.value && (showPanel.value || !props.showResults)
    ? `${listboxId.value}-${activeIndex.value}`
    : undefined
)

function openPanel(): void {
  panelOpen.value = true
}

function close(): void {
  panelOpen.value = false
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
        :aria-activedescendant="activeDescendant"
        data-testid="home-template-search-input"
        @focus="openPanel"
        @keydown.enter.prevent="search.onEnter"
        @keydown.down.prevent="search.move(1)"
        @keydown.up.prevent="search.move(-1)"
      />
      <slot name="controls" />
    </label>

    <TemplateSearchResults
      v-if="showPanel"
      class="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-[rgb(137_137_137/0.16)] bg-content-background p-2 shadow-[0_32px_80px_-24px_rgb(0_0_0/0.75)]"
      data-testid="home-template-search-results"
      :controller="search"
      layout="list"
      :listbox-id="listboxId"
    />
  </div>
</template>
