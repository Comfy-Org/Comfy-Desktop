<script setup lang="ts">
import { ChevronDown, Home, X } from 'lucide-vue-next'
import { AgentChat } from '../icons/agentChat'
import LocationIcon from '../../ui/LocationIcon.vue'
import type { TitleBarCommand, TitleBarState } from '../../titleBarBridge'

/**
 * Mar's title bar (Prototype menu › Title bar › Tabs): only tabs, like
 * Figma. Home is a fixed icon tab; each open workflow and app follows with
 * its own close button. On the right, where things run (it opens the build
 * switcher, so there is no "Open a build" crumb) and the agent. Renders in
 * the app's title bar and the browser preview's stand-in, from the same
 * published state (titleBarBridge.ts). The agent opens on the Home tab, so
 * while it is open the agent button is the one lit, not Home.
 */
const { state } = defineProps<{ state: TitleBarState }>()
const emit = defineEmits<{ command: [cmd: TitleBarCommand] }>()

function openSwitcher(e: MouseEvent): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  emit('command', { type: 'switcher', left: r.left, width: r.width, bottom: r.bottom })
}

const tab = (active: boolean): string =>
  [
    '[-webkit-app-region:no-drag] group flex h-7 min-w-0 shrink cursor-default items-center gap-2 rounded-control text-ui outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
    active
      ? 'bg-secondary-background-hover text-base-foreground'
      : 'text-muted-foreground hover:bg-secondary-background hover:text-base-foreground'
  ].join(' ')
const close = (active: boolean): string =>
  [
    'inline-flex size-5 shrink-0 items-center justify-center rounded-min text-subtle-foreground outline-none hover:bg-secondary-background-hover hover:text-base-foreground focus-visible:opacity-100',
    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
  ].join(' ')
</script>

<template>
  <nav class="proto-ui flex min-w-0 flex-1 items-center gap-1" aria-label="Tabs">
    <button
      type="button"
      :class="[tab(state.home && !state.agent), 'w-8 shrink-0 justify-center']"
      title="Home (⌘⇧H)"
      aria-label="Home"
      :aria-current="state.home ? 'page' : undefined"
      @click="emit('command', { type: 'home' })"
    >
      <Home :size="15" />
    </button>

    <div
      v-for="t in state.tabs ?? []"
      :key="t.id"
      :class="[tab(t.id === state.tabFront), 'max-w-52 pr-1 pl-2']"
      :title="`${t.name} · ${t.build}`"
    >
      <button
        type="button"
        class="flex min-w-0 items-center gap-2 outline-none"
        :aria-current="t.id === state.tabFront ? 'page' : undefined"
        @click="emit('command', { type: 'tab', id: t.id })"
      >
        <LocationIcon :kind="t.kind" :size="14" />
        <span class="truncate">{{ t.name }}</span>
      </button>
      <button
        type="button"
        :aria-label="`Close ${t.name}`"
        :class="close(t.id === state.tabFront)"
        @click="emit('command', { type: 'closeTab', id: t.id })"
      >
        <X :size="12" />
      </button>
    </div>

    <div
      v-for="a in state.apps ?? []"
      :key="a.id"
      :class="[tab(state.appFront === a.id), 'max-w-48 pr-1 pl-1.5']"
    >
      <button
        type="button"
        class="flex min-w-0 items-center gap-2 outline-none"
        :aria-current="state.appFront === a.id ? 'page' : undefined"
        @click="emit('command', { type: 'app', id: a.id })"
      >
        <img :src="a.thumb" alt="" class="size-4 shrink-0 rounded-[4px] object-cover" />
        <span class="truncate">{{ a.name }}</span>
      </button>
      <button
        type="button"
        :aria-label="`Close ${a.name}`"
        :class="close(state.appFront === a.id)"
        @click="emit('command', { type: 'closeApp', id: a.id })"
      >
        <X :size="12" />
      </button>
    </div>

    <span class="flex-1" aria-hidden="true" />

    <button
      v-if="state.runsOn"
      type="button"
      :class="[tab(state.menuOpen), 'shrink-0 pr-1.5 pl-2']"
      title="Where your work runs"
      aria-haspopup="menu"
      :aria-expanded="state.menuOpen"
      @click="openSwitcher"
    >
      <LocationIcon :kind="state.runsOn.kind" :size="14" />
      <span class="max-w-40 truncate">{{ state.runsOn.name }}</span>
      <ChevronDown :size="13" />
    </button>
    <button
      v-if="state.agent !== undefined"
      type="button"
      :class="[tab(state.agent), 'w-8 shrink-0 justify-center']"
      title="Agent"
      aria-label="Agent"
      :aria-pressed="state.agent"
      @click="emit('command', { type: 'agent' })"
    >
      <AgentChat :size="15" />
    </button>
  </nav>
</template>
