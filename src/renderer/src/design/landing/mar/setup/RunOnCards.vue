<script setup lang="ts">
import { Check, Cloud, Laptop } from 'lucide-vue-next'
import type { RunOnCards } from './setupFlow'

/**
 * First screen's Cloud / Local pick as the Home's start cards: neutral
 * surface, icon tile, the pick ringed and checked. Copy is today's, word
 * for word. Two takes (UI Playground › Local setup › First screen cards):
 * cards side by side, or stacked rows.
 */
const { variant } = defineProps<{ variant: Exclude<RunOnCards, 'today'> }>()
const model = defineModel<'cloud' | 'local'>({ required: true })

const WAYS = [
  {
    id: 'cloud',
    icon: Cloud,
    label: 'Cloud',
    tagline: 'Full power. Instant setup.',
    description: 'Best for <b>powerful GPUs</b> and popular custom nodes, ready anywhere.'
  },
  {
    id: 'local',
    icon: Laptop,
    label: 'Local',
    tagline: 'Full control. Your hardware.',
    description:
      'Best for <b>full manual control</b> of versions, custom nodes, and offline workflows.'
  }
] as const
</script>

<template>
  <div
    class="mss-ways"
    :class="`is-${variant}`"
    role="radiogroup"
    data-no-pill
    aria-label="How do you want to run Comfy?"
  >
    <button
      v-for="w in WAYS"
      :key="w.id"
      type="button"
      role="radio"
      class="mss-way"
      :class="`is-${w.id}`"
      :aria-checked="model === w.id"
      @click="model = w.id"
    >
      <span class="mss-way-icon"><component :is="w.icon" :size="17" /></span>
      <span class="mss-way-text">
        <span class="mss-way-title">{{ w.label }}</span>
        <span class="mss-way-tag">{{ w.tagline }}</span>
        <!-- eslint-disable-next-line vue/no-v-html -- static copy, bold spans only -->
        <span class="mss-way-desc" v-html="w.description"></span>
      </span>
      <span class="mss-way-mark" aria-hidden="true"><Check :size="15" :stroke-width="2.5" /></span>
    </button>
  </div>
</template>

<style>
.mss-ways {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  gap: 12px;
  margin-top: 32px;
}
/* The Home's start cards (MarStartOriginal.vue): the card surface over
 * the spotlight, a quiet icon tile, the pick ringed as the flow's radios. */
.mss-way {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  color: var(--color-base-foreground);
  text-align: left;
  cursor: pointer;
  outline: none;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease;
}
.mss-way:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mss-way[aria-checked='true'] {
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 55%, transparent);
}
.mss-way-light {
  display: none;
}
.mss-way-icon {
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-muted-foreground);
  transition: color 160ms ease;
}
.mss-way:hover .mss-way-icon,
.mss-way[aria-checked='true'] .mss-way-icon {
  color: var(--color-base-foreground);
}
.mss-way-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mss-way-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.mss-way-tag {
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
.mss-way-desc {
  margin-top: 8px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  line-height: var(--text-ui--line-height);
  text-wrap: pretty;
}
.mss-way:not([aria-checked='true']) .mss-way-title {
  color: var(--color-muted-foreground);
}
.mss-way-desc b {
  color: var(--color-muted-foreground);
  font-weight: 500;
}
/* Picked: a bare check, top right, as on every picked card of the flow.
 * The card's fill and ring already say it's picked. */
.mss-way-mark {
  position: absolute;
  top: 16px;
  right: 16px;
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--color-base-foreground);
  visibility: hidden;
}
.mss-way[aria-checked='true'] .mss-way-mark {
  visibility: visible;
}

/* Rows: the same cards stacked; the mark is a radio on the right. */
.mss-ways.is-row {
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}
.mss-ways.is-row .mss-way {
  flex-direction: row;
  align-items: center;
}
.mss-ways.is-row .mss-way-desc {
  margin-top: 4px;
}
.mss-ways.is-row .mss-way-mark {
  top: 50%;
  margin-top: -10px;
}
.mss-ways.is-row .mss-way:not([aria-checked='true']) .mss-way-mark {
  visibility: visible;
  background: transparent;
  box-shadow: inset 0 0 0 1.5px color-mix(in oklch, var(--color-base-foreground) 25%, transparent);
  color: transparent;
}

/* Box properties past the prototype's button reset, as the Home does. */
:root .proto-ui.proto-ui.proto-ui .mss-ways .mss-way {
  width: auto;
  height: auto;
  padding: 18px;
  border-radius: 18px;
  background: color-mix(in oklch, var(--color-base-foreground) 3%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mss-ways .mss-way:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mss-ways .mss-way[aria-checked='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mss-ways.is-row .mss-way {
  padding: 16px 52px 16px 16px;
}

@media (prefers-reduced-motion: reduce) {
  .mss-way,
  .mss-way-icon,
  .mss-way-mark {
    transition: none;
  }
}
</style>
