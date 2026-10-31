<script setup lang="ts">
import { ArrowRight, Download, Laptop, Sparkles } from 'lucide-vue-next'
import { onCloud } from '../shell/surface'
import { mock } from '../assets/mock'
import { hostActions } from '../../useProto'
import { INSTANCES } from '../../mock'
import { local, setUpLocal } from './start'
import './start.css'

/**
 * First run · Agent (UI Playground › First run), an exploration: the Agent
 * is paused in the product. Comfy greets you as in a conversation and
 * offers three starter tasks; picking one opens its workflow in ComfyUI on
 * Comfy Cloud, like any example (never the prompt or the agent).
 */
const TASKS = [
  {
    text: 'Put my product on a marble table, soft daylight',
    label: 'Shoot my product',
    src: mock('product-placement-in-one-click')
  },
  {
    text: 'Turn this portrait into a five second video, slow push in',
    label: 'Animate a portrait',
    src: mock('wan-portrait-00011')
  },
  {
    text: 'Make my poster in three sizes for social',
    label: 'Resize a poster',
    src: mock('poster-recomposition')
  }
]
</script>

<template>
  <section class="mar-s-rise mx-auto mt-10 w-full max-w-180" style="--i: 0">
    <div class="mb-3 flex items-center justify-center gap-2">
      <span class="mar-s-badge">Exploration</span>
      <span class="text-ui text-subtle-foreground">The Agent is paused in the product</span>
    </div>
    <div class="mar-s-card p-6">
      <div class="flex gap-3.5">
        <span class="mar-a-avatar"><Sparkles :size="16" /></span>
        <div class="flex min-w-0 flex-1 flex-col gap-4">
          <div class="mar-a-bubble">
            <p>
              Hi Mar, I'm Comfy. Tell me what you want to make and I'll build the workflow, pick the
              models and run it on Cloud.
            </p>
            <p class="mt-2 text-muted-foreground">
              Not sure where to start? Here are three to try.
            </p>
          </div>
          <div class="grid grid-cols-3 gap-2.5" role="list" aria-label="Starter tasks">
            <button
              v-for="t in TASKS"
              :key="t.label"
              type="button"
              role="listitem"
              class="mar-a-task"
              @click="hostActions.launch(INSTANCES[0]!, t.label)"
            >
              <span class="mar-s-tile pointer-events-none aspect-[16/10] w-full"
                ><img :src="t.src" alt=""
              /></span>
              <span class="flex flex-col gap-0.5 px-1 pb-1 text-left">
                <span class="text-ui font-medium text-base-foreground">{{ t.label }}</span>
                <span class="line-clamp-2 text-[12px] leading-snug text-subtle-foreground"
                  >"{{ t.text }}"</span
                >
              </span>
            </button>
          </div>
        </div>
      </div>
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
.mar-a-avatar {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: linear-gradient(135deg, #f4b183, #8e5ea2 55%, #3b5bdb);
  color: #fff;
}
.mar-a-bubble {
  align-self: flex-start;
  max-width: 560px;
  padding: 12px 16px;
  border-radius: 4px 16px 16px 16px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
  font-size: 14px;
  line-height: 1.5;
}
</style>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-a-task {
  display: flex;
  width: auto;
  flex-direction: column;
  gap: 8px;
  padding: 6px;
  border-radius: var(--radius-panel);
  background: color-mix(in oklch, var(--color-base-foreground) 3%, transparent);
  outline: none;
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-a-task:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-a-task:hover img {
  transform: scale(1.05);
}
:root .proto-ui.proto-ui.proto-ui .mar-a-task:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
</style>
