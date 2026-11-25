<script setup lang="ts">
import { ref } from 'vue'
import { hostActions } from '../../useProto'
import { clipSeconds, clock, recent, type RecentItem } from './P04Recent'

/**
 * 04 · Filmstrip: Recently used as tall, borderless film frames. The
 * photo is the card; a grey chip says what it is, the name and where it
 * ran sit underneath. Moving the pointer across a frame scrubs it: the
 * picture pans with the pointer and videos show a playhead with the time.
 */
const scrub = ref<{ id: string; at: number } | null>(null)

function move(e: PointerEvent, r: RecentItem): void {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
  scrub.value = { id: r.w.id, at: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) }
}
const at = (r: RecentItem): number | undefined =>
  scrub.value?.id === r.w.id ? scrub.value.at : undefined

const isVideo = (r: RecentItem): boolean => r.w.category === 'video'
const chip = (r: RecentItem): string =>
  isVideo(r) ? `Video · ${clock(clipSeconds(r.w.id))}` : 'Image'
const meta = (r: RecentItem): string => [r.env?.name, r.w.modified].filter(Boolean).join(' · ')
</script>

<template>
  <div class="p04-strip -mx-1 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-1 pb-1">
    <button
      v-for="r in recent"
      :key="r.w.id"
      type="button"
      class="p04-card group snap-start outline-none"
      :aria-label="`Open ${r.title}`"
      @click="r.env && hostActions.launch(r.env, r.w.name)"
    >
      <span
        class="p04-frame relative block aspect-[173/250] w-full overflow-hidden rounded-[14px] bg-secondary-background"
        @pointermove="move($event, r)"
        @pointerleave="scrub = null"
      >
        <img
          :src="r.src"
          alt=""
          draggable="false"
          class="p04-img absolute inset-0 size-full object-cover"
          :style="
            at(r) === undefined
              ? undefined
              : { objectPosition: `${20 + at(r)! * 60}% 50%`, transform: 'scale(1.08)' }
          "
        />
        <span
          class="absolute top-2 left-2 rounded-[7px] bg-media-overlay px-[7px] py-0.5 text-[11px] leading-[1.4] font-medium text-white/92 backdrop-blur-md"
          >{{ chip(r) }}</span
        >
        <!-- Playhead: only while the pointer scrubs a video. -->
        <span
          v-if="isVideo(r)"
          :class="[
            'p04-scrub absolute inset-x-0 bottom-0 flex h-9 items-center gap-2 bg-linear-to-b from-transparent to-black/60 px-2.5',
            at(r) === undefined ? 'opacity-0' : 'opacity-100'
          ]"
          aria-hidden="true"
        >
          <span class="relative h-[3px] flex-1 overflow-hidden rounded-[2px] bg-white/30">
            <span
              class="absolute inset-y-0 left-0 rounded-[2px] bg-white/95"
              :style="{ width: `${(at(r) ?? 0) * 100}%` }"
            />
          </span>
          <span class="text-[11px] leading-[1.4] font-medium text-white/90 tabular-nums">{{
            clock((at(r) ?? 0) * clipSeconds(r.w.id))
          }}</span>
        </span>
      </span>
      <span class="mt-2.5 block min-w-0">
        <span class="block truncate text-ui font-medium text-base-foreground">{{ r.title }}</span>
        <span class="block truncate text-[12px] leading-[1.4] text-subtle-foreground">{{
          meta(r)
        }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.p04-strip {
  scrollbar-width: none;
}
.p04-strip::-webkit-scrollbar {
  display: none;
}
.p04-img {
  transition:
    transform 400ms cubic-bezier(0.22, 1, 0.36, 1),
    object-position 120ms linear;
}
.p04-scrub {
  transition: opacity 160ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .p04-img,
  .p04-scrub {
    transition: none;
  }
}
</style>

<style>
/* Buttons lose width and padding to the prototype's reset; set them here
   (six frames across, the rest a scroll away). */
:root .proto-ui.proto-ui.proto-ui .p04-card {
  display: block;
  flex: none;
  width: calc((100% - 5 * 14px) / 6);
  padding: 0;
  text-align: left;
  border-radius: 14px;
}
:root .proto-ui.proto-ui.proto-ui .p04-card:focus-visible .p04-frame {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
</style>
