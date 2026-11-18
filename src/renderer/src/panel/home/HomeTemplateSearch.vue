<script setup lang="ts">
import { computed, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle, Search } from '@lucide/vue'
import TemplateSearchResults from './TemplateSearchResults.vue'
import { useTemplateSearch } from './useTemplateSearch'
import { useAuthStore } from '../../stores/authStore'
import { TEMPLATE_SEARCH_MAX_QUERY } from '../../../../shared/templateSearch'

const props = defineProps<{ buildId: string | null }>()
const emit = defineEmits<{ opened: [buildId: string] }>()

const { t } = useI18n()
const listboxId = useId()
const auth = useAuthStore()
const search = useTemplateSearch({
  buildId: () => props.buildId,
  onOpened: (buildId) => emit('opened', buildId),
  signedOut: () => auth.statusLoaded && !auth.isSignedIn,
  signIn: () => void auth.signIn().catch(() => null)
})
const { query, state, panelOpen, activeIndex, activeRow } = search

const showPanel = computed(() => panelOpen.value && state.value.kind !== 'idle')
const activeDescendant = computed(() =>
  activeRow.value && showPanel.value ? `${listboxId}-${activeIndex.value}` : undefined
)

function openPanel(): void {
  panelOpen.value = true
}

function onFocus(): void {
  search.prepare()
  search.open()
}

const input = useTemplateRef<HTMLInputElement>('input')

function focusInput(): void {
  input.value?.focus()
}

function close(): void {
  panelOpen.value = false
}

function onEscape(event: KeyboardEvent): void {
  if (event.target !== input.value) focusInput()
  close()
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null
  if (!(event.currentTarget as HTMLElement).contains(next)) close()
}

function onEnter(event: KeyboardEvent): void {
  if (event.isComposing) return
  event.preventDefault()
  if (!event.repeat) search.onEnter()
}

const results = useTemplateRef<InstanceType<typeof TemplateSearchResults>>('results')

function revealActive(): void {
  results.value?.revealActive()
}

function moveVertically(event: KeyboardEvent, step: 1 | -1): void {
  if (event.isComposing) return
  event.preventDefault()
  const target = results.value?.verticalTarget(step) ?? null
  if (!showPanel.value && search.rows.value.length) search.moveTo(search.activeIndex.value)
  else if (target === null || target === search.activeIndex.value) search.move(step)
  else search.moveTo(target)
  revealActive()
}

function moveAcross(event: KeyboardEvent, step: 1 | -1): void {
  if (event.isComposing || !search.inResults.value || !search.rows.value.length) return
  event.preventDefault()
  search.move(step)
  revealActive()
}
</script>

<template>
  <div
    class="relative mx-auto w-full max-w-180"
    data-testid="home-template-search"
    @focusout="onFocusOut"
    @keydown.esc="onEscape"
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
        ref="input"
        v-model="query"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        :maxlength="TEMPLATE_SEARCH_MAX_QUERY"
        class="h-full min-w-0 flex-auto bg-transparent text-[14px] text-foreground outline-none placeholder:text-subtle-foreground"
        :aria-label="t('home.search.label')"
        :placeholder="t('home.search.placeholder')"
        :aria-expanded="showPanel"
        :aria-controls="listboxId"
        :aria-activedescendant="activeDescendant"
        data-testid="home-template-search-input"
        @focus="onFocus"
        @input="openPanel"
        @mousedown="search.leaveResults()"
        @keydown.enter="onEnter"
        @keydown.down="moveVertically($event, 1)"
        @keydown.up="moveVertically($event, -1)"
        @keydown.left.exact="moveAcross($event, -1)"
        @keydown.right.exact="moveAcross($event, 1)"
      />
    </label>

    <TemplateSearchResults
      v-if="showPanel"
      ref="results"
      class="absolute inset-x-0 top-full z-20 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-[rgb(137_137_137/0.16)] bg-content-background p-2 shadow-[0_32px_80px_-24px_rgb(0_0_0/0.75)]"
      data-testid="home-template-search-results"
      :controller="search"
      :listbox-id="listboxId"
      @refocus="focusInput"
    />
  </div>
</template>
