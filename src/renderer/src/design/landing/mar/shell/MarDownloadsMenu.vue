<script setup lang="ts">
import { ref } from 'vue'
import { ArrowDownToLine, CircleCheck, LoaderCircle, X } from 'lucide-vue-next'
import { PopoverRoot, PopoverTrigger } from 'reka-ui'
import PopoverContent from '../../ui/PopoverContent.vue'
import { toast } from '../../useProto'

/**
 * The title bar's downloads popup, as Desktop ships it (Comfy-Desktop#2017,
 * comfyTitlePopup/DownloadsView.vue): an uppercase label on top, no divider
 * lines, rows on a card fill with the progress drawn through them, and
 * View All Downloads as a menu-style row at the foot.
 */
interface Download {
  id: string
  name: string
  sub: string
  progress?: number
}

const items = ref<Download[]>([
  {
    id: 'flux',
    name: 'flux1-dev-fp8.safetensors',
    sub: '6.2 of 11.9 GB · 48 MB/s · 2 min left',
    progress: 0.52
  },
  { id: 'vae', name: 'ae.safetensors', sub: 'Show in Finder' }
])
const open = ref(false)

function remove(d: Download): void {
  items.value = items.value.filter((x) => x.id !== d.id)
}
function rowStyle(d: Download): Record<string, string> | undefined {
  if (d.progress === undefined) return undefined
  const pct = d.progress * 100
  return {
    background: `linear-gradient(90deg, var(--mar-dl-card) 0%, var(--mar-dl-card) ${pct}%, var(--mar-dl-rest) ${pct + 0.9}%)`
  }
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        aria-label="Downloads"
        title="Downloads"
        :class="[
          'inline-flex size-7 items-center justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
          open
            ? 'bg-secondary-background-hover text-base-foreground'
            : 'text-muted-foreground hover:bg-secondary-background hover:text-base-foreground'
        ]"
      >
        <ArrowDownToLine :size="15" />
      </button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      class="flex w-[360px] flex-col p-0 [--mar-dl-card:var(--color-secondary-background-hover)] [--mar-dl-rest:var(--color-secondary-background)]"
    >
      <header class="px-4 pt-3.5 pb-1">
        <h2 class="m-0 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
          Downloads
        </h2>
      </header>
      <div v-if="!items.length" class="px-4 py-6 text-center text-[12px] text-muted-foreground">
        No downloads yet
      </div>
      <ul v-else class="m-0 flex list-none flex-col gap-2 p-4">
        <li
          v-for="d in items"
          :key="d.id"
          class="flex items-center gap-2 rounded-lg bg-(--mar-dl-card) px-4 py-3"
          :class="d.progress === undefined && 'cursor-pointer'"
          :style="rowStyle(d)"
          @click="d.progress === undefined && toast('Show in Finder')"
        >
          <LoaderCircle
            v-if="d.progress !== undefined"
            :size="16"
            class="mt-0.5 shrink-0 self-start animate-spin [animation-duration:900ms] motion-reduce:animate-none"
          />
          <CircleCheck v-else :size="16" class="mt-0.5 shrink-0 self-start" />
          <span class="flex min-w-0 flex-auto flex-col">
            <span class="truncate text-[14px] leading-5 text-base-foreground" :title="d.name">{{
              d.name
            }}</span>
            <span class="truncate text-[12px] leading-[1.2] text-muted-foreground">{{
              d.sub
            }}</span>
          </span>
          <button
            type="button"
            class="ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:text-base-foreground"
            :aria-label="d.progress === undefined ? 'Remove from list' : 'Cancel'"
            :title="d.progress === undefined ? 'Remove from list' : 'Cancel'"
            @click.stop="remove(d)"
          >
            <X :size="16" />
          </button>
        </li>
      </ul>
      <footer class="flex p-1">
        <button
          type="button"
          class="h-8 flex-auto rounded-control px-3 text-left text-[13px] text-base-foreground outline-none hover:bg-[oklch(1_0_0/0.07)] focus-visible:bg-[oklch(1_0_0/0.07)]"
          @click="toast('View All Downloads')"
        >
          View All Downloads
        </button>
      </footer>
    </PopoverContent>
  </PopoverRoot>
</template>
