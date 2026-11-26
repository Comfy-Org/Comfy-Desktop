<script setup lang="ts">
import { ref } from 'vue'
import { AppWindow, ArrowUpRight } from '@lucide/vue'
import AppBadges from './AppBadges.vue'
import CoverRotation from '../components/CoverRotation.vue'
import { glassPictureOf } from './appCardBadges'
import type { AppCard } from '../types/ipc'

const {
  app,
  playing = false,
  revealed = false,
  descriptionIdPrefix,
  note = null
} = defineProps<{
  app: AppCard
  playing?: boolean
  revealed?: boolean
  descriptionIdPrefix: string
  note?: string | null
}>()

const coverFailed = ref(false)
const coverShowing = ref<number | null>()

const MOTION_CLASS =
  'transition-transform duration-600 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04] group-focus-visible:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100 motion-reduce:group-focus-visible:scale-100'
</script>

<template>
  <component
    :is="note === null ? 'button' : 'div'"
    :type="note === null ? 'button' : undefined"
    class="group relative block aspect-square w-full overflow-hidden rounded-card border-0 bg-[rgb(235_235_235/0.05)] p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
    :class="note === null ? 'cursor-pointer' : 'cursor-default'"
  >
    <span
      class="absolute inset-0 block overflow-hidden"
      :class="note === null ? MOTION_CLASS : ''"
      data-testid="app-card-picture"
    >
      <CoverRotation
        v-if="app.covers.length > 0 && !coverFailed"
        :pictures="app.covers"
        :paused="!playing"
        load-on-play
        @broken="coverFailed = true"
        @showing="coverShowing = $event"
      />
      <span
        v-else
        class="flex size-full items-center justify-center text-subtle-foreground"
        data-testid="app-card-no-cover"
      >
        <AppWindow :size="28" :stroke-width="1.5" aria-hidden="true" />
      </span>
    </span>
    <AppBadges
      v-if="app.badges?.length"
      :badges="app.badges"
      :description-id-prefix="descriptionIdPrefix"
      :revealed="revealed"
      :glass-picture="coverFailed ? null : glassPictureOf(app.covers, coverShowing)"
      class="absolute top-2 left-2 max-w-[calc(100%-1rem)]"
    />
    <span
      class="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgb(0_0_0/0.7),rgb(0_0_0/0.55)_28%,transparent_60%)]"
      aria-hidden="true"
      data-testid="app-card-scrim"
    />
    <template v-if="note === null">
      <span
        class="absolute top-3 right-3 grid size-8 scale-90 place-items-center rounded-[9px] bg-white/20 text-white opacity-0 backdrop-blur-[14px] backdrop-saturate-150 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-100 group-hover:opacity-100 group-hover:delay-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 motion-reduce:scale-100 motion-reduce:transition-none"
        aria-hidden="true"
        data-testid="app-card-go"
      >
        <ArrowUpRight :size="16" :stroke-width="2.25" />
      </span>
      <span class="absolute inset-x-3.5 bottom-3 grid">
        <span
          data-testid="app-card-name"
          class="truncate text-sm/[17px] font-semibold text-white transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [grid-area:1/1] group-hover:-translate-y-4.5 group-focus-visible:-translate-y-4.5 motion-reduce:transition-none"
        >
          {{ app.title }}
        </span>
        <span
          class="translate-y-1.5 self-end truncate text-xs/4 text-white/78 opacity-0 transition-[opacity,translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [grid-area:1/1] group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none"
        >
          {{ app.description }}
        </span>
      </span>
    </template>
    <span v-else class="absolute inset-x-3.5 bottom-3 flex flex-col gap-0.5">
      <span data-testid="app-card-name" class="truncate text-sm/[17px] font-semibold text-white">
        {{ app.title }}
      </span>
      <span v-if="app.description" class="truncate text-xs/4 text-white/78">
        {{ app.description }}
      </span>
      <span class="truncate text-xs/4 text-white/60" data-testid="app-card-note">
        {{ note }}
      </span>
    </span>
  </component>
</template>
