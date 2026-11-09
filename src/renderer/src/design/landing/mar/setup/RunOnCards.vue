<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import SetupCloud from './SetupCloud.vue'
import SetupLaptop from './SetupLaptop.vue'
import { localSetup, type RunOnCards } from './setupFlow'

/**
 * First screen's Cloud / Local pick as the Home's build cards: the machine
 * drawn (the Home's cloud and laptop), lit in its own hue from the corner,
 * the pick ringed and checked. Copy is today's, word for word. Two takes
 * (UI Playground › Local setup › First screen cards): cards side by side,
 * or stacked rows.
 */
const { variant } = defineProps<{ variant: Exclude<RunOnCards, 'today'> }>()
const model = defineModel<'cloud' | 'local'>({ required: true })

// The Home's build hues: the cloud's blue, the first local build's warm light.
const WAYS = [
  {
    id: 'cloud',
    hue: 210,
    label: 'Cloud',
    tagline: 'Full power. Instant setup.',
    description: 'Best for <b>powerful GPUs</b> and popular custom nodes, ready anywhere.'
  },
  {
    id: 'local',
    hue: 50,
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
    aria-label="How do you want to run ComfyUI?"
  >
    <button
      v-for="w in WAYS"
      :key="w.id"
      type="button"
      role="radio"
      class="mss-way"
      :class="`is-${w.id}`"
      :style="{ '--h': w.hue }"
      :aria-checked="model === w.id"
      @click="model = w.id"
    >
      <span class="mss-way-device">
        <SetupCloud v-if="w.id === 'cloud'" :hue="w.hue" />
        <template v-else>
          <SetupLaptop :os="localSetup.os" />
          <!-- The build's hue on its screen, as the Builds row lights it. -->
          <span class="mss-way-screen" aria-hidden="true"></span>
        </template>
      </span>
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
/* The Home's build cards (MarBuildsRow.vue): the machine drawn, the card
 * lit from its corner in the build's hue, the pick ringed as the flow's
 * radios. */
.mss-way {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  color: var(--color-base-foreground);
  text-align: left;
  cursor: pointer;
  outline: none;
  box-shadow: inset 0 0 0 1px oklch(0.8 0.06 var(--h, 0) / 0.12);
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease;
}
.mss-way:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mss-way[aria-checked='true'] {
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 55%, transparent),
    0 12px 32px -16px oklch(0.6 0.12 var(--h, 0) / 0.5);
}
/* Lit from its corner in the build's own hue, as the Builds row; the
 * pick glows a little more, the other card sits back. */
.mss-way::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  background: radial-gradient(
    ellipse 60% 130% at 8% 0%,
    oklch(0.7 0.15 var(--h, 0) / 0.26),
    transparent 70%
  );
  content: '';
  opacity: 0.5;
  transform-origin: 8% 0%;
  transition:
    opacity 200ms ease,
    transform 500ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mss-way:hover::before {
  opacity: 1;
}
.mss-way[aria-checked='true']::before {
  opacity: 1;
  transform: scale(1.6);
}
.mss-way-device {
  position: relative;
  display: block;
  flex: none;
}
.mss-way .mss-laptop {
  width: 116px;
  height: 75px;
  margin: -4px 0 -2px -6px;
}
/* Over the laptop's screen (its box in SetupLaptop's 160 × 104 drawing). */
.mss-way-screen {
  position: absolute;
  top: 8.2%;
  right: 14%;
  bottom: 22.6%;
  left: 14%;
  border-radius: 2px;
  background: radial-gradient(
    ellipse 90% 90% at 30% 25%,
    oklch(0.74 0.16 var(--h, 0) / 0.8),
    oklch(0.55 0.14 var(--h, 0) / 0.3) 65%,
    transparent
  );
  mix-blend-mode: screen;
  pointer-events: none;
}
.mss-way:not([aria-checked='true']) .mss-way-device {
  opacity: 0.8;
  transition: opacity 160ms ease;
}
.mss-way:hover .mss-way-device {
  opacity: 1;
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
  margin-top: 10px;
  max-width: 34ch;
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
.mss-ways.is-row .mss-way .mss-laptop {
  width: 88px;
  height: 57px;
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
  padding: 20px 20px 22px;
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
  .mss-way::before,
  .mss-way-device,
  .mss-way-mark {
    transition: none;
  }
}
</style>
