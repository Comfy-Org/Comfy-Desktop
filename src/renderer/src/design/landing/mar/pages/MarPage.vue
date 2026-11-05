<script setup lang="ts">
import { computed, type Component } from 'vue'
import { CloudOff, RotateCw, SearchX } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { retry, shownState, type PageState } from './pageState'
import MarEmpty from './MarEmpty.vue'
import '../table/table.css'

/**
 * The frame every library page in Mar's proposal shares: the title and
 * its one primary action, the toolbar, then the page in its state.
 * Loading keeps the toolbar and shows skeletons in the page's own shape;
 * Empty drops the toolbar and invites the one action that fills the page;
 * Error says what's unreachable and what still works, with Retry; a filter
 * that matches nothing offers to clear it. All three are MarEmpty.
 */
export interface EmptyCopy {
  icon: Component
  title: string
  text: string
  action: string
  /** A quieter second way in, e.g. "Browse templates". */
  second?: string
  /** Three pictures of what will live here, fanned above the title. */
  pics?: string[]
}

const {
  title,
  skeleton = 'grid',
  empty,
  errorTitle = "Can't reach Comfy Cloud",
  errorText = "You look offline. What's on this computer still opens; the rest comes back when you reconnect.",
  noResults = false,
  state,
  embedded = false,
  toolbarTo
} = defineProps<{
  title: string
  skeleton?: 'grid' | 'list' | 'cards' | 'settings'
  empty?: EmptyCopy
  errorTitle?: string
  errorText?: string
  /** Filters on, nothing matches. */
  noResults?: boolean
  /** Overrides the UI Playground's page state (e.g. a page with no empty). */
  state?: PageState
  /** Inside another page (a project's tab): no title, no page margins. */
  embedded?: boolean
  /** Where the toolbar docks instead (a host's tab row), as a selector. */
  toolbarTo?: string
}>()
const emit = defineEmits<{ action: []; second: []; clear: [] }>()

const shown = computed<PageState>(() => {
  const s = state ?? shownState.value
  return s === 'empty' && !empty ? 'live' : s
})
const rows = computed(() => (skeleton === 'grid' ? 8 : skeleton === 'cards' ? 6 : 7))
</script>

<template>
  <div
    class="mar-page"
    :class="embedded ? 'is-embedded' : 'mx-auto w-full max-w-300 px-10 pb-24'"
    :data-state="shown"
  >
    <!-- A page about one thing (a project, a space) brings its own header. -->
    <slot v-if="!embedded" name="header" :state="shown">
      <header class="mar-page-head">
        <div class="min-w-0">
          <div class="flex items-center gap-3">
            <slot name="lead" />
            <h1 class="mar-page-title">{{ title }}</h1>
            <slot name="meta" />
          </div>
        </div>
        <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
          <slot name="actions" :state="shown" />
        </div>
      </header>
    </slot>

    <slot name="tabs" :state="shown" />

    <Teleport defer :to="toolbarTo" :disabled="!toolbarTo">
      <div
        v-if="$slots.toolbar && (shown === 'live' || shown === 'loading')"
        class="mar-page-bar"
        :inert="shown === 'loading'"
        :class="[shown === 'loading' && 'is-dim', toolbarTo && 'is-docked']"
      >
        <slot name="toolbar" />
      </div>
    </Teleport>

    <!-- Loading: the page's own shape, shimmering. -->
    <div v-if="shown === 'loading'" aria-busy="true" aria-label="Loading">
      <div
        v-if="skeleton === 'grid' || skeleton === 'cards'"
        class="mar-sk-grid"
        :class="skeleton === 'cards' && 'is-cards'"
      >
        <div v-for="n in rows" :key="n" class="mar-sk-card">
          <span class="mar-sk mar-sk-media" />
          <span class="mar-sk mar-sk-line" :style="{ width: `${55 + ((n * 17) % 35)}%` }" />
          <span class="mar-sk mar-sk-line is-sm" :style="{ width: `${30 + ((n * 11) % 25)}%` }" />
        </div>
      </div>
      <!-- A list loads in the one table's shape (../table/table.css). -->
      <div
        v-else-if="skeleton === 'list'"
        class="mar-table is-items"
        style="--mar-cols: minmax(0, 200px) 120px"
      >
        <div class="mar-table-head">
          <span><span class="mar-sk mar-sk-line is-sm" style="width: 48px" /></span>
          <span><span class="mar-sk mar-sk-line is-sm" style="width: 56px" /></span>
          <span><span class="mar-sk mar-sk-line is-sm" style="width: 44px" /></span>
          <span /><span />
        </div>
        <div v-for="n in rows" :key="n" class="mar-table-row mar-table-sk">
          <span class="mar-sk mar-sk-thumb" />
          <span class="flex flex-col gap-1.5">
            <span class="mar-sk mar-sk-line" :style="{ width: `${28 + ((n * 13) % 22)}%` }" />
            <span class="mar-sk mar-sk-line is-sm" :style="{ width: `${16 + ((n * 7) % 12)}%` }" />
          </span>
          <span class="mar-sk mar-sk-line is-sm" :style="{ width: `${50 + ((n * 11) % 30)}%` }" />
          <span class="mar-sk mar-sk-line is-sm" style="width: 60%" />
          <span /><span />
        </div>
      </div>
      <div v-else class="mar-sk-settings">
        <div v-for="n in 6" :key="n" class="mar-sk-row">
          <span class="flex flex-1 flex-col gap-2">
            <span class="mar-sk mar-sk-line" :style="{ width: `${24 + ((n * 7) % 18)}%` }" />
            <span class="mar-sk mar-sk-line is-sm" :style="{ width: `${40 + ((n * 13) % 25)}%` }" />
          </span>
          <span class="mar-sk mar-sk-ctl" />
        </div>
      </div>
    </div>

    <!-- Empty: first use. What lives here, and the one thing that fills it. -->
    <MarEmpty
      v-else-if="shown === 'empty' && empty"
      :icon="empty.icon"
      :title="empty.title"
      :text="empty.text"
      :action="empty.action"
      :second="empty.second"
      :pics="empty.pics"
      :compact="embedded"
      @action="emit('action')"
      @second="emit('second')"
    />

    <!-- Error: what's out of reach, what still works, and a retry. -->
    <div v-else-if="shown === 'error'" role="alert">
      <MarEmpty
        :icon="CloudOff"
        :title="errorTitle"
        :text="errorText"
        :compact="embedded"
        tone="error"
      >
        <Button @click="retry"><RotateCw :size="14" />Try again</Button>
      </MarEmpty>
    </div>

    <!-- Live, but the filters leave nothing. -->
    <MarEmpty
      v-else-if="noResults"
      :icon="SearchX"
      title="Nothing matches"
      text="Try another word, or clear the filters to see everything."
      compact
      tone="error"
      action="Clear filters"
      @action="emit('clear')"
    />

    <slot v-else />
  </div>
</template>

<style scoped>
.mar-page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 8px 0 24px;
}
.mar-page-title {
  margin: 0;
  font-size: var(--text-title, 24px);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.mar-page-bar {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  transition: opacity 200ms ease;
}
.mar-page-bar.is-docked {
  margin: 0;
}
.mar-page-bar.is-dim {
  opacity: 0.45;
}

/* Skeletons */
.mar-sk {
  display: block;
  border-radius: 6px;
  background: linear-gradient(
      100deg,
      transparent 30%,
      color-mix(in oklch, var(--color-base-foreground) 6%, transparent) 50%,
      transparent 70%
    )
    color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  background-size: 250% 100%;
  animation: mar-shimmer 1.4s linear infinite;
}
.mar-sk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.mar-sk-grid.is-cards {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.mar-sk-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 4px 10px;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-card-background) 50%, transparent);
}
.mar-sk-media {
  aspect-ratio: 16 / 10;
  border-radius: var(--radius-control);
  margin-bottom: 4px;
}
.mar-sk-card .mar-sk-line {
  margin-left: 8px;
}
.mar-sk-line {
  height: 10px;
}
.mar-sk-line.is-sm {
  height: 8px;
  opacity: 0.7;
}
.mar-sk-settings {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mar-sk-row {
  display: flex;
  height: 56px;
  align-items: center;
  gap: 14px;
  padding: 0 12px;
  border-radius: 12px;
}
.mar-sk-settings .mar-sk-row {
  height: 68px;
  border-bottom: 1px solid var(--color-border-default);
  border-radius: 0;
}
.mar-sk-thumb {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 8px;
}
.mar-sk-ctl {
  width: 120px;
  height: 28px;
  border-radius: 8px;
}
@keyframes mar-shimmer {
  to {
    background-position: -150% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-sk {
    animation: none;
  }
}
</style>
