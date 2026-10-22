<script setup lang="ts">
import { ChevronDown, ChevronRight, Home, LayoutGrid } from 'lucide-vue-next'
import LocationIcon from '../../ui/LocationIcon.vue'
import type { TitleBarCommand, TitleBarState } from '../../titleBarBridge'

/**
 * The title bar's breadcrumb (Milestone 3 on): the launcher's root - Home,
 * or Builds before Home exists - › the build in front (hovering its name
 * opens the build's info card), then a chevron to switch builds. The root
 * is always in the bar, so the way back from ComfyUI is in view. Renders in
 * the launcher's title bar, each build window's, and the browser preview's
 * stand-in; it only shows `state` and emits what was clicked
 * (titleBarBridge.ts).
 */
const { state } = defineProps<{ state: TitleBarState }>()
const emit = defineEmits<{ command: [cmd: TitleBarCommand] }>()

function info(phase: 'enter' | 'leave' | 'click', e: MouseEvent): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  emit('command', { type: 'info', phase, left: r.left, bottom: r.bottom })
}

function openSwitcher(e: MouseEvent): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  emit('command', { type: 'switcher', left: r.left, width: r.width, bottom: r.bottom })
}

// Window controls: the title bar is a drag region except its buttons.
const crumb = (active: boolean): string =>
  [
    '[-webkit-app-region:no-drag] flex h-7 cursor-default items-center gap-2 rounded-control text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
    active
      ? 'bg-secondary-background-hover text-base-foreground'
      : 'text-muted-foreground hover:bg-secondary-background hover:text-base-foreground'
  ].join(' ')
</script>

<template>
  <nav class="proto-ui flex min-w-0 items-center gap-0.5" aria-label="Breadcrumb">
    <button
      type="button"
      :class="[crumb(state.home), 'shrink-0 pr-2.5 pl-2', !state.home && 'bg-transparent']"
      :title="state.milestone >= 7 ? 'Home (⌘⇧H)' : undefined"
      :aria-current="state.home ? 'page' : undefined"
      @click="emit('command', { type: 'home' })"
    >
      <template v-if="state.milestone >= 4"><Home :size="15" />Home</template>
      <template v-else><LayoutGrid :size="15" />Builds</template>
    </button>
    <ChevronRight :size="14" class="shrink-0 text-subtle-foreground" aria-hidden="true" />
    <button
      v-if="state.front"
      type="button"
      :class="[crumb(true), 'min-w-0 bg-transparent px-2']"
      aria-current="page"
      @mouseenter="info('enter', $event)"
      @mouseleave="info('leave', $event)"
      @click="info('click', $event)"
    >
      <LocationIcon :kind="state.front.kind" :size="15" />
      <span class="max-w-48 truncate">{{ state.front.name }}</span>
    </button>
    <button
      type="button"
      :class="[crumb(state.menuOpen), state.front ? 'w-6 justify-center' : 'pr-1.5 pl-2']"
      aria-label="Switch build"
      aria-haspopup="menu"
      :aria-expanded="state.menuOpen"
      @click="openSwitcher"
    >
      <span v-if="!state.front">Open a build</span>
      <ChevronDown :size="13" />
    </button>
  </nav>
</template>
