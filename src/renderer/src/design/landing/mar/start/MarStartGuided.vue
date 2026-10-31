<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { ArrowRight, Check, Cloud, Download, Laptop, RotateCcw } from 'lucide-vue-next'
import { onCloud } from '../shell/surface'
import { EXAMPLES, reducedMotion, runExample, type Example } from '../userStates/examples'
import { local, setUpLocal } from './start'
import './start.css'

/**
 * First run · Guided (UI Playground › First run): the first creation, in
 * three steps on the Home itself. Pick an example, watch it run on Comfy
 * Cloud, then open it in the editor to see the workflow behind it. The
 * run is a preview: the real one happens when the editor opens.
 */
const STEPS = ['Pick an example', 'Watch it run', 'Open it in the editor']
const step = ref(0)
const picked = ref<Example | null>(null)
const progress = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

function pick(x: Example): void {
  picked.value = x
  step.value = 1
  progress.value = 0
  clearInterval(timer)
  if (reducedMotion()) {
    progress.value = 100
    step.value = 2
    return
  }
  timer = setInterval(() => {
    progress.value = Math.min(100, progress.value + 4)
    if (progress.value >= 100) {
      clearInterval(timer)
      step.value = 2
    }
  }, 90)
}
function again(): void {
  clearInterval(timer)
  step.value = 0
  picked.value = null
}
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <section class="mar-s-rise mt-10" style="--i: 0">
    <div class="mar-s-card p-6">
      <ol class="mar-g-steps" aria-label="Your first creation">
        <li
          v-for="(s, i) in STEPS"
          :key="s"
          :class="[i === step && 'is-now', i < step && 'is-done']"
          :aria-current="i === step ? 'step' : undefined"
        >
          <span class="mar-g-num"
            ><Check v-if="i < step" :size="12" /><template v-else>{{ i + 1 }}</template></span
          >
          {{ s }}
        </li>
      </ol>

      <Transition name="mar-g-swap" mode="out-in">
        <!-- 1 · Pick -->
        <div v-if="step === 0" key="pick" class="mt-6 grid grid-cols-5 gap-3">
          <button
            v-for="x in EXAMPLES"
            :key="x.label"
            type="button"
            class="mar-s-tile aspect-[4/5]"
            @click="pick(x)"
          >
            <img :src="x.src" alt="" />
            <span class="mar-s-shade" />
            <span class="absolute inset-x-3 bottom-3 flex flex-col gap-0.5">
              <span class="text-ui leading-snug font-medium text-white">{{ x.label }}</span>
              <span class="text-[11px] text-white/65">{{ x.kind }} · {{ x.runs }}</span>
            </span>
          </button>
        </div>

        <!-- 2 · Run, 3 · Open -->
        <div
          v-else-if="picked"
          key="run"
          class="mt-6 grid grid-cols-[280px_1fr] items-center gap-8"
        >
          <div class="mar-g-pic">
            <img :src="picked.src" alt="" :class="step === 1 && 'is-running'" />
            <img
              v-if="step === 1"
              :src="picked.src"
              alt=""
              class="mar-g-scan"
              :style="{ '--p': `${progress}%` }"
            />
            <span v-if="step === 2" class="mar-s-chip absolute top-3 left-3">Done</span>
          </div>
          <div class="flex flex-col gap-4" aria-live="polite">
            <div class="flex flex-col gap-1.5">
              <span class="mar-s-eyebrow flex items-center gap-1.5"
                ><Cloud :size="13" />{{
                  step === 1 ? 'Running on Comfy Cloud' : 'Ran on Comfy Cloud'
                }}
                · {{ picked.runs }}</span
              >
              <span class="mar-s-title">{{
                step === 1 ? picked.label : `${picked.label}: your first result`
              }}</span>
            </div>
            <div
              v-if="step === 1"
              class="mar-g-bar"
              role="progressbar"
              :aria-valuenow="progress"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span :style="{ width: `${progress}%` }" />
            </div>
            <p v-else class="max-w-100 text-ui text-muted-foreground">
              It's a workflow: open it to see the nodes that made it, change any of them and run it
              again.
            </p>
            <div v-if="step === 2" class="flex items-center gap-2">
              <button type="button" class="mar-s-btn is-primary" @click="runExample(picked)">
                Open in the editor<ArrowRight :size="14" />
              </button>
              <button type="button" class="mar-s-btn is-ghost" @click="again">
                <RotateCcw :size="13" />Try another
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <div class="mt-4 flex items-center justify-center gap-2 text-ui text-subtle-foreground">
      <Laptop :size="14" />{{ local.note }}.
      <button type="button" class="mar-s-btn is-ghost h-7! px-2!" @click="setUpLocal">
        {{ local.short }}<component :is="onCloud ? Download : ArrowRight" :size="13" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.mar-g-steps {
  display: flex;
  gap: 8px;
  color: var(--color-subtle-foreground);
  font-size: 13px;
}
.mar-g-steps > li {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 2px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  transition:
    color 200ms ease,
    border-color 300ms ease;
}
.mar-g-steps > li.is-now {
  border-color: var(--color-base-foreground);
  color: var(--color-base-foreground);
  font-weight: 500;
}
.mar-g-steps > li.is-done {
  border-color: color-mix(in oklch, var(--color-base-foreground) 40%, transparent);
  color: var(--color-muted-foreground);
}
.mar-g-num {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.is-now .mar-g-num {
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
.mar-g-pic {
  position: relative;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
}
.mar-g-pic img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: filter 500ms ease;
}
.mar-g-pic img.is-running {
  filter: blur(14px) saturate(0.6);
}
/* The result resolves from the top down as the run progresses. */
.mar-g-pic .mar-g-scan {
  -webkit-mask: linear-gradient(180deg, #000 var(--p), transparent calc(var(--p) + 8%));
  mask: linear-gradient(180deg, #000 var(--p), transparent calc(var(--p) + 8%));
}
.mar-g-bar {
  height: 4px;
  max-width: 320px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-g-bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-base-foreground);
  transition: width 90ms linear;
}
.mar-g-swap-enter-active,
.mar-g-swap-leave-active {
  transition:
    opacity 200ms ease,
    transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-g-swap-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.mar-g-swap-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .mar-g-steps > li,
  .mar-g-pic img,
  .mar-g-bar > span,
  .mar-g-swap-enter-active,
  .mar-g-swap-leave-active {
    transition: none;
  }
}
</style>
