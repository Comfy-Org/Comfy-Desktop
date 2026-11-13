<script setup lang="ts">
import { computed } from 'vue'
import { Check, Play } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { brandMotif } from '../brand/brandMotif'
import { thumb, type Tutorial } from '../../mock'

/** "Start here": the Basics lessons as one short course, in order. The
 *  lesson you're on leads (big image, one button); the whole course sits
 *  next to it as a numbered list with what's done. */
const { lessons } = defineProps<{ lessons: Tutorial[] }>()
defineEmits<{ open: [t: Tutorial] }>()

const isDone = (t: Tutorial): boolean => (t.progress ?? 0) >= 1
const done = computed(() => lessons.filter(isDone).length)
const total = computed(() => lessons.reduce((n, t) => n + t.minutes, 0))
const allDone = computed(() => done.value === lessons.length)
const nextIdx = computed(() => (allDone.value ? 0 : lessons.findIndex((t) => !isDone(t))))
const next = computed(() => lessons[nextIdx.value] as Tutorial)
const left = computed(() =>
  Math.max(1, Math.round(next.value.minutes * (1 - (next.value.progress ?? 0))))
)
const cta = computed(() =>
  allDone.value
    ? 'Watch again'
    : (next.value.progress ?? 0) > 0
      ? 'Continue lesson'
      : 'Start lesson'
)
</script>

<template>
  <div class="mar-learn-course edge-shine rounded-card bg-card-background shadow-elev">
    <!-- The lesson you're on. -->
    <button
      type="button"
      class="mar-learn-next group"
      :aria-label="`Play ${next.title}`"
      @click="$emit('open', next)"
    >
      <img :src="thumb(next.thumbId)" alt="" class="size-full object-cover" />
      <span class="mar-learn-play" aria-hidden="true"><Play :size="18" fill="currentColor" /></span>
      <span class="mar-learn-next-text">
        <span class="text-ui opacity-75">{{
          allDone ? 'Course complete' : `Lesson ${nextIdx + 1} of ${lessons.length}`
        }}</span>
        <span class="mt-0.5 text-[17px] font-semibold tracking-[-0.01em]">{{ next.title }}</span>
        <span class="mt-0.5 text-ui opacity-75">{{ next.blurb }}</span>
      </span>
      <span v-if="(next.progress ?? 0) > 0 && !allDone" class="mar-learn-bar"
        ><span :style="{ width: `${(next.progress ?? 0) * 100}%` }"
      /></span>
    </button>

    <!-- The whole course. -->
    <div class="flex min-w-0 flex-col pt-2.5">
      <div class="flex items-baseline justify-between gap-3 px-2">
        <p class="text-ui font-medium">ComfyUI basics</p>
        <p class="text-ui text-subtle-foreground tabular-nums">
          {{ done }} of {{ lessons.length }} done · {{ total }} min
        </p>
      </div>
      <div
        class="mar-learn-steps mx-2 mt-2.5"
        :class="brandMotif.id === 'trio' && 'is-trio'"
        aria-hidden="true"
      >
        <span
          v-for="(t, i) in lessons"
          :key="t.title"
          :class="{ 'is-done': isDone(t), 'is-current': i === nextIdx && !allDone }"
          ><span v-if="!isDone(t)" :style="{ width: `${(t.progress ?? 0) * 100}%` }"
        /></span>
      </div>
      <ol class="mt-3 flex flex-col gap-0.5">
        <li v-for="(t, i) in lessons" :key="t.title">
          <button
            type="button"
            class="mar-learn-row"
            :class="{ 'is-current': i === nextIdx && !allDone }"
            :aria-current="i === nextIdx && !allDone ? 'step' : undefined"
            @click="$emit('open', t)"
          >
            <span class="mar-learn-mark" :class="{ 'is-done': isDone(t) }">
              <Check v-if="isDone(t)" :size="12" :stroke-width="2.75" />
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span
              class="min-w-0 flex-1 truncate text-left"
              :class="isDone(t) ? 'text-muted-foreground' : 'text-base-foreground'"
              >{{ t.title }}</span
            >
            <span class="shrink-0 text-subtle-foreground tabular-nums">{{ t.minutes }} min</span>
          </button>
        </li>
      </ol>
      <div class="mt-auto flex items-center gap-3 px-2 pt-4">
        <Button variant="primary" @click="$emit('open', next)"
          ><Play :size="13" fill="currentColor" />{{ cta }}</Button
        >
        <span v-if="!allDone" class="text-ui text-subtle-foreground tabular-nums"
          >{{ left }} min{{ (next.progress ?? 0) > 0 ? ' left' : '' }}</span
        >
      </div>
    </div>
  </div>
</template>

<style>
.mar-learn-course {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 24px;
  padding: 12px 12px 14px;
}
@media (max-width: 960px) {
  .mar-learn-course {
    grid-template-columns: minmax(0, 1fr);
  }
}
:root .proto-ui.proto-ui.proto-ui .mar-learn-next {
  position: relative;
  display: block;
  width: 100%;
  overflow: hidden;
  min-height: 300px;
  border-radius: var(--radius-control);
  background: var(--color-card-background-hover);
}
/* The lesson's name sits on the image, over a soft shade. */
.mar-learn-next-text {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  padding: 64px 18px 18px;
  color: oklch(1 0 0);
  text-align: left;
  background: linear-gradient(to top, oklch(0 0 0 / 0.8), oklch(0 0 0 / 0.45) 55%, transparent);
}
.mar-learn-next > img {
  position: absolute;
  inset: 0;
}
.mar-learn-next:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
/* Course progress: one segment per lesson. */
.mar-learn-steps {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: 4px;
}
.mar-learn-steps > span {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-learn-steps > span > span {
  display: block;
  height: 100%;
  background: var(--color-base-foreground);
}
.mar-learn-steps > span.is-done {
  background: var(--color-base-foreground);
}
/* Brand motif (brandMotif.ts): steps as pips at the C mark's 16°. Done
   is material, the current one an open slot, the rest card tone. */
.mar-learn-steps.is-trio {
  display: flex;
  gap: 3px;
  padding-left: 2px;
}
.mar-learn-steps.is-trio > span {
  width: 16px;
  height: 9px;
  border-radius: 2.5px;
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  transform: skewX(-16deg);
}
.mar-learn-steps.is-trio > span > span {
  display: none;
}
.mar-learn-steps.is-trio > span.is-done {
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--color-muted-foreground), white 8%),
    var(--color-muted-foreground)
  );
}
.mar-learn-steps.is-trio > span.is-current {
  background: transparent;
  box-shadow: inset 0 0 0 1.25px var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-learn-row {
  display: flex;
  width: 100%;
  height: 40px;
  align-items: center;
  gap: 12px;
  padding: 0 10px 0 8px;
  border-radius: var(--radius-control);
  font-size: var(--text-ui, 13px);
  transition: background-color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-learn-row:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-learn-row.is-current {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-learn-mark {
  display: grid;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 999px;
  color: var(--color-muted-foreground);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 18%, transparent);
}
.mar-learn-row.is-current .mar-learn-mark {
  color: var(--color-base-foreground);
  box-shadow: inset 0 0 0 1.5px var(--color-base-foreground);
}
.mar-learn-mark.is-done {
  color: var(--color-inverted-foreground);
  background: var(--color-base-foreground);
  box-shadow: none;
}
</style>
