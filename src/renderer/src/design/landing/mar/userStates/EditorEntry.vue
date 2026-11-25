<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, Check, Cloud, Download, Laptop } from 'lucide-vue-next'
import { hostActions, proto } from '../../useProto'
import { INSTANCES } from '../../mock'
import { creditsTotal } from '../credits'
import { onCloud } from '../shell/surface'
import { editorEntry } from './editorEntry'
import MiniGraph from './MiniGraph.vue'

/**
 * Node editor entry on a first-time Home (UI Playground › Node editor
 * entry), for those who already know ComfyUI: open the editor on Comfy
 * Cloud or on this computer. The local action follows the surface: on
 * Cloud it installs the Desktop app, on Desktop it sets up ComfyUI here.
 * Today's two rows stay in MarStartOriginal.vue.
 */
const where = ref<'cloud' | 'local'>('cloud')

const cloud = computed(() => ({
  action: proto.signedIn ? 'Open on Cloud' : 'Sign in to Cloud',
  facts: ['Fast GPUs, every model ready', `${creditsTotal.value} credits to spend`]
}))
const local = computed(() => ({
  action: onCloud.value ? 'Install Desktop' : 'Set up',
  facts: onCloud.value
    ? ['Get the Desktop app', 'Your own GPU, works offline']
    : ['Runs on your GPU', 'Works offline, your files stay here']
}))
const LocalIcon = computed(() => (onCloud.value ? Download : ArrowRight))

function openCloud(): void {
  if (proto.signedIn) hostActions.launch(INSTANCES[0]!)
  else hostActions.signIn()
}
function openLocal(): void {
  hostActions.newInstance()
}
</script>

<template>
  <!-- Graph: two cards, each with a node graph above what it gives you. -->
  <div v-if="editorEntry.id === 'graph'" class="grid grid-cols-2 gap-3.5">
    <div class="mar-ee-card flex flex-col">
      <div class="mar-ee-art h-44"><MiniGraph /></div>
      <div class="flex items-end gap-4 p-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="flex items-center gap-2 text-ui font-medium text-base-foreground">
            <Cloud :size="15" class="text-muted-foreground" />Comfy Cloud
            <span class="mar-ee-badge">Recommended</span>
          </span>
          <span class="text-ui text-subtle-foreground">{{ cloud.facts.join(' · ') }}</span>
        </div>
        <button type="button" class="mar-ee-btn is-primary" @click="openCloud">
          {{ cloud.action }}<ArrowRight :size="14" />
        </button>
      </div>
    </div>
    <div class="mar-ee-card flex flex-col">
      <div class="mar-ee-art h-44"><MiniGraph /></div>
      <div class="flex items-end gap-4 p-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="flex items-center gap-2 text-ui font-medium text-base-foreground">
            <Laptop :size="15" class="text-muted-foreground" />This computer
          </span>
          <span class="text-ui text-subtle-foreground">{{ local.facts.join(' · ') }}</span>
        </div>
        <button type="button" class="mar-ee-btn" @click="openLocal">
          {{ local.action }}<component :is="LocalIcon" :size="14" />
        </button>
      </div>
    </div>
  </div>

  <!-- Split: one card, Cloud recommended and larger, this computer beside. -->
  <div v-else-if="editorEntry.id === 'split'" class="mar-ee-card mar-ee-split">
    <div class="flex flex-col gap-4 p-5">
      <div class="flex items-center gap-3">
        <span class="mar-ee-icon is-accent"><Cloud :size="18" /></span>
        <span class="text-[15px] font-semibold text-base-foreground">Comfy Cloud</span>
        <span class="mar-ee-badge">Recommended</span>
      </div>
      <ul class="flex flex-col gap-2">
        <li
          v-for="f in cloud.facts"
          :key="f"
          class="flex items-center gap-2 text-ui text-muted-foreground"
        >
          <Check :size="14" class="text-base-foreground" />{{ f }}
        </li>
      </ul>
      <button type="button" class="mar-ee-btn is-primary self-start" @click="openCloud">
        {{ cloud.action }}<ArrowRight :size="14" />
      </button>
    </div>
    <div class="mar-ee-split-side flex flex-col gap-4 p-5">
      <div class="flex items-center gap-3">
        <span class="mar-ee-icon"><Laptop :size="18" /></span>
        <span class="text-[15px] font-semibold text-base-foreground">This computer</span>
      </div>
      <ul class="flex flex-col gap-2">
        <li
          v-for="f in local.facts"
          :key="f"
          class="flex items-center gap-2 text-ui text-muted-foreground"
        >
          <Check :size="14" class="text-subtle-foreground" />{{ f }}
        </li>
      </ul>
      <button type="button" class="mar-ee-btn self-start" @click="openLocal">
        {{ local.action }}<component :is="LocalIcon" :size="14" />
      </button>
    </div>
  </div>

  <!-- Canvas: compact cards, a mini canvas thumbnail and one clear action. -->
  <div v-else-if="editorEntry.id === 'canvas'" class="grid grid-cols-2 gap-3.5">
    <div class="mar-ee-card flex items-center gap-4 p-2.5 pr-4">
      <div class="mar-ee-art mar-ee-thumb"><MiniGraph bare /></div>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex items-center gap-1.5 text-ui font-medium text-base-foreground">
          <Cloud :size="14" class="text-muted-foreground" />Comfy Cloud
        </span>
        <span class="truncate text-ui text-subtle-foreground">{{ cloud.facts[0] }}</span>
      </div>
      <button type="button" class="mar-ee-btn is-primary" @click="openCloud">
        {{ proto.signedIn ? 'Open' : 'Sign in' }}
      </button>
    </div>
    <div class="mar-ee-card flex items-center gap-4 p-2.5 pr-4">
      <div class="mar-ee-art mar-ee-thumb"><MiniGraph bare /></div>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex items-center gap-1.5 text-ui font-medium text-base-foreground">
          <Laptop :size="14" class="text-muted-foreground" />This computer
        </span>
        <span class="truncate text-ui text-subtle-foreground">{{ local.facts[0] }}</span>
      </div>
      <button type="button" class="mar-ee-btn" @click="openLocal">
        {{ onCloud ? 'Install' : 'Set up' }}
      </button>
    </div>
  </div>

  <!-- Banner: one wide card, pick where it runs, then open. -->
  <div v-else-if="editorEntry.id === 'banner'" class="mar-ee-card mar-ee-banner">
    <div class="flex flex-col justify-center gap-4 p-6">
      <div class="flex flex-col gap-1">
        <span
          class="text-[20px] leading-tight font-semibold tracking-[-0.01em] text-base-foreground"
          >Open the node editor</span
        >
        <span class="text-ui text-subtle-foreground"
          >For ComfyUI users: build any workflow from nodes.</span
        >
      </div>
      <div
        class="mar-ee-switch"
        role="radiogroup"
        aria-label="Where it runs"
        @keydown.left.prevent="where = 'cloud'"
        @keydown.right.prevent="where = 'local'"
      >
        <button
          type="button"
          role="radio"
          :aria-checked="where === 'cloud'"
          :tabindex="where === 'cloud' ? 0 : -1"
          :class="where === 'cloud' && 'is-on'"
          @click="where = 'cloud'"
        >
          <Cloud :size="14" />Comfy Cloud
        </button>
        <button
          type="button"
          role="radio"
          :aria-checked="where === 'local'"
          :tabindex="where === 'local' ? 0 : -1"
          :class="where === 'local' && 'is-on'"
          @click="where = 'local'"
        >
          <Laptop :size="14" />This computer
        </button>
      </div>
      <span class="text-ui text-muted-foreground">{{
        (where === 'cloud' ? cloud : local).facts.join(' · ')
      }}</span>
      <button
        type="button"
        class="mar-ee-btn is-primary self-start"
        @click="where === 'cloud' ? openCloud() : openLocal()"
      >
        {{ where === 'cloud' ? cloud.action : local.action
        }}<component :is="where === 'cloud' ? ArrowRight : LocalIcon" :size="14" />
      </button>
    </div>
    <div class="mar-ee-art"><MiniGraph /></div>
  </div>
</template>

<style scoped>
.mar-ee-card {
  overflow: hidden;
  border-radius: var(--radius-panel);
  background: color-mix(in oklch, var(--color-card-background) 92%, transparent);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
}
:global(:root[data-ds-theme='light'] .mar-ee-card) {
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.04),
    0 1px 2px rgb(0 0 0 / 0.04),
    0 12px 32px -18px rgb(0 0 0 / 0.16);
}
.mar-ee-art {
  position: relative;
  overflow: hidden;
  background: color-mix(in oklch, var(--color-base-foreground) 3%, transparent);
}
.mar-ee-thumb {
  width: 112px;
  height: 72px;
  flex-shrink: 0;
  border-radius: var(--radius-card);
}
.mar-ee-badge {
  border-radius: 999px;
  padding: 1px 8px;
  background: color-mix(in oklch, #3b82f6 16%, transparent);
  color: color-mix(in oklch, #3b82f6 70%, var(--color-base-foreground));
  font-size: 11px;
  font-weight: 500;
}
.mar-ee-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-muted-foreground);
}
.mar-ee-icon.is-accent {
  background: color-mix(in oklch, #3b82f6 16%, transparent);
  color: color-mix(in oklch, #3b82f6 75%, var(--color-base-foreground));
}
.mar-ee-split {
  display: grid;
  grid-template-columns: 1.25fr 1fr;
}
.mar-ee-split-side {
  background: color-mix(in oklch, var(--color-base-foreground) 2.5%, transparent);
  box-shadow: inset 1px 0 0 color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.mar-ee-banner {
  display: grid;
  min-height: 220px;
  grid-template-columns: 1fr 1.1fr;
}
</style>

<style>
/* Global: these are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-ee-btn {
  display: inline-flex;
  width: auto;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  outline: none;
  transition:
    background-color 160ms ease,
    opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-ee-btn:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 13%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-ee-btn.is-primary {
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-ee-btn.is-primary:hover {
  opacity: 0.88;
}
:root .proto-ui.proto-ui.proto-ui .mar-ee-btn:focus-visible,
:root .proto-ui.proto-ui.proto-ui .mar-ee-switch > button:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .mar-ee-switch {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-ee-switch > button {
  display: inline-flex;
  width: auto;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
  font-size: 13px;
  outline: none;
  transition:
    background-color 160ms ease,
    color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-ee-switch > button.is-on {
  background: var(--color-card-background);
  color: var(--color-base-foreground);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
}
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-ee-switch > button.is-on {
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .mar-ee-btn,
  :root .proto-ui.proto-ui.proto-ui .mar-ee-switch > button {
    transition: none;
  }
}
</style>
