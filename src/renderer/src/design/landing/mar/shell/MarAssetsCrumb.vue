<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { ComfyAssets } from '../icons/comfyIcons'
import type { TitleBarCommand } from '../../titleBarBridge'

/**
 * ComfyUI's Assets tab in the title bar (Glass), after the build like an
 * app tab. Pablo's breadcrumb passes its own crumb classes, so it looks
 * the same as the app tabs beside it.
 */
const { front, crumb } = defineProps<{ front: boolean; crumb: string }>()
const emit = defineEmits<{ command: [cmd: TitleBarCommand] }>()
</script>

<template>
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
