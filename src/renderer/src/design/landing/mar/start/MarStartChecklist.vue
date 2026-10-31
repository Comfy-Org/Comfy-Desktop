<script setup lang="ts">
import { computed, reactive } from 'vue'
import { ArrowRight, Check, PlayCircle } from 'lucide-vue-next'
import { go } from '../../useProto'
import { mock } from '../assets/mock'
import { EXAMPLES, runExample } from '../userStates/examples'
import { local, setUpLocal } from './start'
import './start.css'

/**
 * First run · Checklist (UI Playground › First run): a compact Home with a
 * calm "Get started" card beside it. Each step opens where it's done and
 * ticks itself; nothing blocks the Home, and the card can wait.
 */
const done = reactive<Record<string, boolean>>({ account: true })
const steps = computed(() => [
  { id: 'account', label: 'Create your account', hint: 'Done' },
  {
    id: 'run',
    label: 'Run your first example',
    hint: `${EXAMPLES[0]!.label}, ${EXAMPLES[0]!.runs}`,
    act: () => runExample(EXAMPLES[0]!)
  },
  {
    id: 'explore',
    label: 'Explore templates',
    hint: 'Ready workflows to start from',
    act: () => go('explore')
  },
  { id: 'local', label: local.value.action, hint: local.value.note, act: setUpLocal },
  {
    id: 'team',
    label: 'Invite your team',
    hint: 'Share credits and workflows',
    act: () => go('people')
  }
])
const count = computed(() => steps.value.filter((s) => done[s.id]).length)
const next = computed(() => steps.value.find((s) => !done[s.id])?.id)

function open(s: { id: string; act?: () => void }): void {
  done[s.id] = true
  s.act?.()
}
const LEARN = [
  {
    title: 'Your first workflow, node by node',
    length: '4 min',
    src: mock('cleanplate-walkthrough')
  },
  {
    title: 'Text to image and image to image',
    length: '6 min',
    src: mock('text-to-image-and-image-to-image')
  }
]
</script>

<template>
  <section class="mar-s-rise mt-10 grid grid-cols-[1fr_340px] items-start gap-6" style="--i: 0">
    <div class="flex flex-col gap-8">
      <div>
        <h2 class="mb-3.5 text-ui font-semibold">Try an example</h2>
        <div class="grid grid-cols-3 gap-3">
          <button
            v-for="x in EXAMPLES.slice(1, 4)"
            :key="x.label"
            type="button"
            class="mar-s-tile aspect-[4/3]"
            @click="runExample(x)"
          >
            <img :src="x.src" alt="" />
            <span class="mar-s-shade" />
            <span class="absolute inset-x-3 bottom-3 flex flex-col gap-0.5">
              <span class="text-ui leading-snug font-medium text-white">{{ x.label }}</span>
              <span class="text-[11px] text-white/65">{{ x.kind }} · {{ x.runs }}</span>
            </span>
          </button>
        </div>
      </div>
      <div>
        <h2 class="mb-3.5 text-ui font-semibold">Learn the basics</h2>
        <div class="grid grid-cols-2 gap-3">
          <button
            v-for="l in LEARN"
            :key="l.title"
            type="button"
            class="mar-k-learn"
            @click="go('tutorials')"
          >
            <span class="mar-s-tile pointer-events-none aspect-video shrink-0" style="width: 112px">
              <img :src="l.src" alt="" />
              <span class="absolute inset-0 flex items-center justify-center text-white"
                ><PlayCircle :size="20"
              /></span>
            </span>
            <span class="flex min-w-0 flex-col gap-0.5 text-left">
              <span class="text-ui leading-snug font-medium text-base-foreground">{{
                l.title
              }}</span>
              <span class="text-ui text-subtle-foreground">{{ l.length }}</span>
            </span>
          </button>
        </div>
      </div>
    </div>

    <aside class="mar-s-card p-5" aria-label="Get started">
      <div class="flex items-center justify-between">
        <span class="text-[15px] font-semibold text-base-foreground">Get started</span>
        <span class="text-ui text-subtle-foreground tabular-nums"
          >{{ count }} of {{ steps.length }}</span
        >
      </div>
      <div
        class="mar-k-bar mt-3"
        role="progressbar"
        :aria-valuenow="count"
        aria-valuemin="0"
        :aria-valuemax="steps.length"
      >
        <span :style="{ width: `${(count / steps.length) * 100}%` }" />
      </div>
      <ul class="mt-4 flex flex-col gap-0.5">
        <li v-for="s in steps" :key="s.id">
          <button
            type="button"
            class="mar-k-step"
            :class="[done[s.id] && 'is-done', next === s.id && 'is-next']"
            :disabled="!s.act"
            @click="open(s)"
          >
            <span class="mar-k-check"><Check v-if="done[s.id]" :size="12" /></span>
            <span class="flex min-w-0 flex-1 flex-col text-left">
              <span class="mar-k-label">{{ s.label }}</span>
              <span v-if="next === s.id" class="text-ui text-subtle-foreground">{{ s.hint }}</span>
            </span>
            <ArrowRight v-if="s.act && !done[s.id]" :size="14" class="mar-k-go" />
          </button>
        </li>
      </ul>
    </aside>
  </section>
</template>

<style scoped>
.mar-k-bar {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-k-bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #22c55e;
  transition: width 500ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-k-check {
  display: inline-flex;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1.5px color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
  color: #fff;
}
.is-done .mar-k-check {
  background: #22c55e;
  box-shadow: none;
}
.mar-k-label {
  color: var(--color-base-foreground);
  font-size: 13px;
}
.is-done .mar-k-label {
  color: var(--color-subtle-foreground);
  text-decoration: line-through;
  text-decoration-color: color-mix(in oklch, var(--color-base-foreground) 25%, transparent);
}
.is-next .mar-k-label {
  font-weight: 500;
}
.mar-k-go {
  color: var(--color-subtle-foreground);
}
@media (prefers-reduced-motion: reduce) {
  .mar-k-bar > span {
    transition: none;
  }
}
</style>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-k-step {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: var(--radius-control);
  outline: none;
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-k-step.is-next {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-k-step:not(:disabled):hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-k-step:disabled {
  cursor: default;
}
:root .proto-ui.proto-ui.proto-ui .mar-k-step:focus-visible,
:root .proto-ui.proto-ui.proto-ui .mar-k-learn:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .mar-k-learn {
  display: flex;
  width: auto;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: var(--radius-panel);
  outline: none;
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-k-learn:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
</style>
