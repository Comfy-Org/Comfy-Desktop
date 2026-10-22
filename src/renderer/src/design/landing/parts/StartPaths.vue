<script setup lang="ts">
import { ArrowRight, Play, Rocket } from 'lucide-vue-next'
import Greeting from './Greeting.vue'
import RunArt from './RunArt.vue'
import StarterCards from './StarterCards.vue'
import { hostActions, proto } from '../useProto'
import { INSTANCES } from '../mock'

/**
 * First run (Home, Milestone 4): two ways to start.
 *   1. Run an example workflow.
 *   2. Open ComfyUI - pick where it runs: Comfy Cloud or this computer.
 */
const RUNS = [
  {
    key: 'cloud' as const,
    title: 'Comfy Cloud',
    body: 'Fast GPUs, every model ready.',
    run: () => openCloud()
  },
  {
    key: 'local' as const,
    title: 'This computer',
    body: 'Runs on your GPU, works offline.',
    run: () => hostActions.newInstance()
  }
]
function openCloud(): void {
  if (proto.signedIn) hostActions.launch(INSTANCES[0]!)
  else hostActions.signIn()
}
</script>

<template>
  <section class="mx-auto w-full max-w-180">
    <Greeting text="How do you want to start?" class="mb-9!" />

    <!-- 1 · An example -->
    <p class="mb-2.5 flex items-center gap-2 px-1 text-ui">
      <Play :size="14" class="text-muted-foreground" />
      <span class="font-medium">Run an example</span>
      <span class="text-subtle-foreground">· see what ComfyUI makes</span>
    </p>
    <StarterCards />

    <!-- Clearly separate: a second, different way in. -->
    <div class="mt-10 mb-6 flex items-center gap-3 text-ui text-subtle-foreground">
      <span class="h-px flex-1 bg-border-default" />or<span class="h-px flex-1 bg-border-default" />
    </div>

    <!-- 2 · ComfyUI: pick where it runs -->
    <p class="mb-2.5 flex items-center gap-2 px-1 text-ui">
      <Rocket :size="14" class="text-muted-foreground" />
      <span class="font-medium">Open ComfyUI</span>
      <span class="text-subtle-foreground">· build it yourself in the node editor</span>
    </p>
    <div class="grid grid-cols-2 gap-3">
      <button
        v-for="o in RUNS"
        :key="o.key"
        type="button"
        class="run group relative flex h-28 items-center gap-6 overflow-hidden rounded-card border border-border-strong bg-secondary-background px-5 text-left outline-none hover:bg-secondary-background-hover focus-visible:ring-2 focus-visible:ring-border-focus"
        @click="o.run()"
      >
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1.5 text-ui font-medium">
            {{ o.title }}
            <ArrowRight
              :size="14"
              class="go text-subtle-foreground group-hover:text-base-foreground"
            />
          </span>
          <span class="mt-1 block text-ui text-muted-foreground">{{ o.body }}</span>
        </span>
        <RunArt :kind="o.key" class="h-20 w-28 shrink-0 opacity-70" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.run {
  transition:
    background-color 150ms ease,
    transform 300ms cubic-bezier(0.19, 1, 0.22, 1);
}
.go {
  transition: transform 500ms cubic-bezier(0.19, 1, 0.22, 1);
}
@media (hover: hover) and (pointer: fine) {
  .run:hover .go {
    transform: translateX(3px);
  }
}
.run:active {
  transform: scale(0.99);
}
@media (prefers-reduced-motion: reduce) {
  .run,
  .go {
    transition: none;
  }
}
</style>
