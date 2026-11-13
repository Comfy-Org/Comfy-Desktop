<script setup lang="ts">
import { ref } from 'vue'
import { Menu } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import { go, toast, type Page } from '../../useProto'

/**
 * The title bar's ☰ menu, as Desktop ships it (Comfy-Desktop#2016,
 * titlePopup.ts buildTitlePopupMenuItems): at the left of the title bar,
 * like every desktop app. The tools first (they left the sidebar), then
 * Desktop Settings, then the window. No Open Dashboard: Home is in the
 * sidebar. Built from the same menu parts as the filter menus on Apps and
 * Benchmarks; labels start at the left edge, no icon column, as in #2016.
 */
const GROUPS: { label: string; run: () => void }[][] = [
  [
    { label: 'Performance Tests', run: () => go('tool:performance') },
    { label: 'Benchmarks', run: () => go('tool:benchmarks') }
  ],
  [{ label: 'Desktop Settings', run: () => go('settings' as Page) }],
  [
    { label: 'Close Window', run: () => toast('Close Window') },
    { label: 'Quit Desktop', run: () => toast('Quit Desktop') }
  ]
]
const open = ref(false)
</script>

<template>
  <DropdownMenuRoot v-model:open="open" :modal="false">
    <DropdownMenuTrigger as-child>
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
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" :side-offset="6" loop class="min-w-52">
      <template v-for="(g, gi) in GROUPS" :key="gi">
        <DropdownMenuSeparator v-if="gi" />
        <DropdownMenuItem v-for="i in g" :key="i.label" @select="i.run()">{{
          i.label
        }}</DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>
