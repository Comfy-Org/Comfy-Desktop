<script setup lang="ts">
import { ArrowRight, Check, Download, Palette, Workflow } from 'lucide-vue-next'
import { onCloud } from '../shell/surface'
import { mock } from '../assets/mock'
import MiniGraph from '../userStates/MiniGraph.vue'
import { EXAMPLES, runExample } from '../userStates/examples'
import { local, openCloud, setUpLocal } from './start'
import './start.css'

/**
 * First run · Paths (UI Playground › First run): two ways in, side by side.
 * Create, for making images and video (its two examples open in ComfyUI
 * on Comfy Cloud); Build, for wiring
 * workflows and serving them as APIs. Each says what it gives you, and
 * neither hides the other: the Create and Build modes behind them.
 */
const TRY = EXAMPLES.slice(0, 2)
</script>

<template>
  <section class="mar-s-rise mt-10 grid grid-cols-2 gap-4" style="--i: 0">
    <article class="mar-s-card flex flex-col">
      <div class="mar-p-art">
        <img :src="mock('hero-shot-v4')" alt="" />
        <span class="mar-p-fade" />
      </div>
      <div class="flex flex-1 flex-col gap-4 p-6 pt-0">
        <div class="flex flex-col gap-1.5">
          <span class="mar-s-eyebrow flex items-center gap-1.5"><Palette :size="13" />Create</span>
          <span class="mar-s-title">Make images and video</span>
        </div>
        <ul class="flex flex-col gap-2 text-ui text-muted-foreground">
          <li class="flex items-center gap-2">
            <Check :size="14" />Start from a workflow that already works
          </li>
          <li class="flex items-center gap-2">
            <Check :size="14" />Change a picture or a word, run it again
          </li>
          <li class="flex items-center gap-2">
            <Check :size="14" />Runs on Comfy Cloud, nothing to install
          </li>
        </ul>
        <div class="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <button
            v-for="(x, i) in TRY"
            :key="x.label"
            type="button"
            :class="['mar-s-btn', i === 0 && 'is-primary']"
            @click="runExample(x)"
          >
            Try: {{ x.label }}<ArrowRight v-if="i === 0" :size="14" />
          </button>
        </div>
      </div>
    </article>

    <article class="mar-s-card flex flex-col">
      <div class="mar-p-art">
        <MiniGraph />
        <span class="mar-p-fade" />
      </div>
      <div class="flex flex-1 flex-col gap-4 p-6 pt-0">
        <div class="flex flex-col gap-1.5">
          <span class="mar-s-eyebrow flex items-center gap-1.5"><Workflow :size="13" />Build</span>
          <span class="mar-s-title">Build workflows and APIs</span>
        </div>
        <ul class="flex flex-col gap-2 text-ui text-muted-foreground">
          <li class="flex items-center gap-2">
            <Check :size="14" />Wire any model in the node editor
          </li>
          <li class="flex items-center gap-2"><Check :size="14" />Serve a workflow as an API</li>
          <li class="flex items-center gap-2">
            <Check :size="14" />Bring your own models and custom nodes
          </li>
        </ul>
        <div class="mt-auto flex items-center gap-2 pt-2">
          <button type="button" class="mar-s-btn is-primary" @click="openCloud">
            Open the node editor<ArrowRight :size="14" />
          </button>
          <button type="button" class="mar-s-btn" @click="setUpLocal">
            {{ local.action }}<component :is="onCloud ? Download : ArrowRight" :size="14" />
          </button>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.mar-p-art {
  position: relative;
  height: 180px;
  overflow: hidden;
}
.mar-p-art :deep(.mar-mg) {
  padding: 16px 24px 28px;
}
.mar-p-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* The picture melts into the card, so the panel reads as one surface. */
.mar-p-fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 30%, var(--mar-p-card) 100%);
  --mar-p-card: var(--color-card-background);
}
:global(:root[data-ds-theme='light'] .mar-p-fade) {
  --mar-p-card: #fff;
}
</style>
