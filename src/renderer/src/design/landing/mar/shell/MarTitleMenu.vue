<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChartColumn, Gauge, Menu } from 'lucide-vue-next'
import { go, proto, toast, type Page } from '../../useProto'
import MarItemMenu from '../pages/MarItemMenu.vue'
import type { MenuLine } from '../pages/menu'

/**
 * The title bar's ☰ menu, as Desktop ships it (titlePopup.ts
 * buildTitlePopupMenuItems), last on the right (Comfy-Desktop#2027).
 * The Desktop window holds only the tools, each with its icon, in the
 * same menu as every other (Comfy-Desktop#2178): closing and quitting are
 * the OS's (⌘W, ⌘Q). A build window (a ComfyUI tab in front) keeps its
 * longer menu with no icons (Comfy-Desktop#2146).
 */
const desktop: MenuLine[] = [
  { label: 'Performance tests', icon: Gauge, run: () => go('tool:performance') },
  { label: 'Benchmarks', icon: ChartColumn, run: () => go('tool:benchmarks') }
]
const buildWindow: MenuLine[] = [
  { label: 'Performance Tests', run: () => go('tool:performance') },
  { label: 'Benchmarks', run: () => go('tool:benchmarks') },
  'sep',
  { label: 'Desktop Settings', run: () => go('settings' as Page) },
  { label: 'Reset Zoom', run: () => toast('Zoom reset') },
  'sep',
  { label: 'Close Window', run: () => toast('Close Window') },
  { label: 'Quit Desktop', run: () => toast('Quit Desktop') }
]
const lines = computed(() => (proto.activeTab === 'home' ? desktop : buildWindow))
const open = ref(false)
</script>

<template>
  <MarItemMenu v-model:open="open" :lines label="Menu">
    <template #trigger>
      <button
        type="button"
        aria-label="Menu"
        title="Menu"
        :class="[
          'inline-flex size-7 shrink-0 items-center justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
          open
            ? 'bg-secondary-background-hover text-base-foreground'
            : 'text-muted-foreground hover:bg-secondary-background hover:text-base-foreground'
        ]"
      >
        <Menu :size="16" />
      </button>
    </template>
  </MarItemMenu>
</template>
