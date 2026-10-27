<script setup lang="ts">
import { ChevronDown, ChevronRight, Home, LayoutGrid, X } from 'lucide-vue-next'
import LocationIcon from '../../ui/LocationIcon.vue'
import type { TitleBarCommand, TitleBarState } from '../../titleBarBridge'

/**
 * The title bar's breadcrumb (Milestone 3 on): the launcher's root - Home,
 * or Builds before Home exists - › the build in front (hovering its name
 * opens the build's info card), then a chevron to switch builds. The root
 * is always in the bar, so the way back from ComfyUI is in view. Renders in
 * the launcher's title bar, each build window's, and the browser preview's
 * stand-in; it only shows `state` and emits what was clicked
 * (titleBarBridge.ts). From Milestone 10, apps opened with "Open app"
 * follow as tabs, one per app, each with a close button.
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

    <!-- App tabs -->
    <template v-if="state.apps?.length">
      <span class="mx-1.5 h-4 w-px shrink-0 bg-border-default" aria-hidden="true" />
      <div
        v-for="a in state.apps"
        :key="a.id"
        :class="[
          crumb(state.appFront === a.id),
          'group min-w-0 shrink pr-1 pl-1.5',
          state.appFront !== a.id && 'bg-transparent'
        ]"
      >
        <button
          type="button"
          class="flex min-w-0 items-center gap-2 outline-none"
          :aria-current="state.appFront === a.id ? 'page' : undefined"
          @click="emit('command', { type: 'app', id: a.id })"
        >
          <img :src="a.thumb" alt="" class="size-4 shrink-0 rounded-[4px] object-cover" />
          <span class="max-w-40 truncate">{{ a.name }}</span>
        </button>
        <button
          type="button"
          :aria-label="`Close ${a.name}`"
          :class="[
            'inline-flex size-5 shrink-0 items-center justify-center rounded-min text-subtle-foreground outline-none hover:bg-secondary-background-hover hover:text-base-foreground focus-visible:opacity-100',
            state.appFront === a.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          ]"
          @click="emit('command', { type: 'closeApp', id: a.id })"
        >
          <X :size="12" />
        </button>
      </div>
    </template>
  </nav>
</template>
