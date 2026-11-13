<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { ComfyAssets, ComfyWorkflow } from '../icons/comfyIcons'
import { assetsTab } from '../graph/comfyLook'
import type { TitleBarCommand } from '../../titleBarBridge'

/**
 * ComfyUI's Assets tab in the title bar (Glass), after the build like an
 * app tab, with the workflow it opened beside as the build's first tab:
 * the two read as the build's tabs, not a tab hanging off a crumb.
 * Pablo's breadcrumb passes its own crumb classes, on and off, so they
 * look the same as the app tabs beside them.
 */
const { front, crumb, crumbOff } = defineProps<{
  front: boolean
  crumb: string
  /** The crumb classes for the other state, for the workflow tab. */
  crumbOff?: string
}>()
const emit = defineEmits<{ command: [cmd: TitleBarCommand] }>()
</script>

<template>
  <button
    type="button"
    :class="[crumbOff ?? '', 'min-w-0 shrink gap-2 px-2', front && 'bg-transparent']"
    :aria-current="front ? undefined : 'page'"
    @click="assetsTab.on = false"
  >
    <ComfyWorkflow class="size-4 shrink-0" />
    <span class="max-w-40 truncate">{{ assetsTab.workflow || 'Workflow' }}</span>
  </button>
  <div :class="[crumb, 'group min-w-0 shrink pr-1 pl-1.5', !front && 'bg-transparent']">
    <button
      type="button"
      class="flex min-w-0 items-center gap-2 outline-none"
      :aria-current="front ? 'page' : undefined"
      @click="emit('command', { type: 'assets' })"
    >
      <ComfyAssets class="size-4 shrink-0" />
      <span class="max-w-40 truncate">Assets</span>
    </button>
    <button
      type="button"
      aria-label="Close Assets"
      :class="[
        'inline-flex size-5 shrink-0 items-center justify-center rounded-min text-subtle-foreground outline-none hover:bg-secondary-background-hover hover:text-base-foreground focus-visible:opacity-100',
        front ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      ]"
      @click="emit('command', { type: 'closeAssets' })"
    >
      <X :size="12" />
    </button>
  </div>
</template>
