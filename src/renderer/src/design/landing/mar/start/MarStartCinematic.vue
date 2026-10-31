<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowRight, Cloud, Download, Laptop, Pause, Play } from 'lucide-vue-next'
import { hostActions } from '../../useProto'
import { INSTANCES } from '../../mock'
import { onCloud } from '../shell/surface'
import { mock } from '../assets/mock'
import { reducedMotion } from '../userStates/examples'
import { CLIPS, local, openCloud, setUpLocal } from './start'
import './start.css'

/**
 * First run · Cinematic (UI Playground › First run): what Comfy makes,
 * full width and playing, under the greeting and prompt. One piece at a
 * time crossfades into the next; "Make this" opens its workflow on Comfy
 * Cloud. Beside it, quietly, this computer and the node editor.
 */
const REEL = [
  {
    title: 'Clouds at play',
    kind: 'Video · text to video',
    still: mock('clip-clouds'),
    video: `${CLIPS}/clouds.webm`
  },
  {
    title: 'A flower blooms at night',
    kind: 'Video · text to video',
    still: mock('clip-flower'),
    video: `${CLIPS}/flower.webm`
  },
  {
    title: 'Mountains at dusk',
    kind: 'Video · image to video',
    still: mock('clip-dusk-mountains'),
    video: `${CLIPS}/dusk_mountains.webm`
  }
]
const at = ref(0)
const playing = ref(!reducedMotion())
let timer: ReturnType<typeof setInterval> | undefined

function start(): void {
  clearInterval(timer)
  if (playing.value) timer = setInterval(() => (at.value = (at.value + 1) % REEL.length), 6500)
}
function toggle(): void {
  playing.value = !playing.value
  start()
}
function show(i: number): void {
  at.value = i
  start()
}
onMounted(start)
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <section class="mar-s-rise mt-10 grid grid-cols-[1fr_300px] gap-4" style="--i: 0">
    <div class="mar-c-stage" aria-roledescription="carousel" aria-label="Made with Comfy">
      <TransitionGroup name="mar-c-fade">
        <div v-for="(r, i) in REEL" v-show="i === at" :key="r.title" class="mar-c-slide">
          <img :src="r.still" alt="" />
          <video v-if="playing && i === at" :src="r.video" autoplay muted loop playsinline />
        </div>
      </TransitionGroup>
      <span class="mar-c-shade" />
      <div
        class="absolute inset-x-7 bottom-6 flex items-end justify-between gap-6"
        aria-live="polite"
      >
        <div class="flex flex-col gap-1.5">
          <span class="text-[12px] font-medium tracking-[0.02em] text-white/70"
            >Made with Comfy · {{ REEL[at]!.kind }}</span
          >
          <span class="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-white">{{
            REEL[at]!.title
          }}</span>
          <div class="mt-3 flex items-center gap-2">
            <button
              type="button"
              class="mar-s-btn is-light"
              @click="hostActions.launch(INSTANCES[0]!, REEL[at]!.title)"
            >
              Make this<ArrowRight :size="14" />
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-for="(r, i) in REEL"
            :key="r.title"
            type="button"
            class="mar-c-dot"
            :class="i === at && 'is-on'"
            :aria-label="`Show ${r.title}`"
            :aria-current="i === at ? 'true' : undefined"
            @click="show(i)"
          />
          <button
            type="button"
            class="mar-c-play"
            :aria-label="playing ? 'Pause' : 'Play'"
            @click="toggle"
          >
            <Pause v-if="playing" :size="13" /><Play v-else :size="13" />
          </button>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <div class="mar-s-card flex flex-1 flex-col gap-3 p-5">
        <span class="mar-c-icon"><Laptop :size="17" /></span>
        <div class="flex flex-col gap-1">
          <span class="text-ui font-medium text-base-foreground">This computer</span>
          <span class="text-ui text-subtle-foreground">{{ local.note }}.</span>
        </div>
        <button type="button" class="mar-s-btn mt-auto self-start" @click="setUpLocal">
          {{ local.action }}<component :is="onCloud ? Download : ArrowRight" :size="14" />
        </button>
      </div>
      <div class="mar-s-card flex flex-1 flex-col gap-3 p-5">
        <span class="mar-c-icon"><Cloud :size="17" /></span>
        <div class="flex flex-col gap-1">
          <span class="text-ui font-medium text-base-foreground">For ComfyUI users</span>
          <span class="text-ui text-subtle-foreground"
            >Build your own workflow in the node editor.</span
          >
        </div>
        <button type="button" class="mar-s-btn mt-auto self-start" @click="openCloud">
          Open the editor<ArrowRight :size="14" />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mar-c-stage {
  position: relative;
  height: 440px;
  overflow: hidden;
  border-radius: var(--radius-panel);
  background: #0b0b0c;
}
.mar-c-slide,
.mar-c-slide img,
.mar-c-slide video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mar-c-shade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, transparent 45%, rgb(0 0 0 / 0.72)),
    radial-gradient(90% 60% at 0% 100%, rgb(0 0 0 / 0.35), transparent);
  pointer-events: none;
}
.mar-c-fade-enter-active,
.mar-c-fade-leave-active {
  transition: opacity 1200ms ease;
}
.mar-c-fade-enter-from,
.mar-c-fade-leave-to {
  opacity: 0;
}
.mar-c-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-muted-foreground);
}
@media (prefers-reduced-motion: reduce) {
  .mar-c-fade-enter-active,
  .mar-c-fade-leave-active {
    transition: none;
  }
}
</style>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-c-dot {
  width: 8px;
  height: 8px;
  padding: 0;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.4);
  outline: none;
  transition:
    width 300ms cubic-bezier(0.16, 1, 0.3, 1),
    background-color 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-c-dot.is-on {
  width: 22px;
  background: #fff;
}
:root .proto-ui.proto-ui.proto-ui .mar-c-play {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  padding: 0;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.16);
  backdrop-filter: blur(12px);
  color: #fff;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .mar-c-dot:focus-visible,
:root .proto-ui.proto-ui.proto-ui .mar-c-play:focus-visible {
  box-shadow: 0 0 0 2px #fff;
}
</style>
