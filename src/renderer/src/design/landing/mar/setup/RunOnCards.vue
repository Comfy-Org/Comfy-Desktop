<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import SetupCloud from './SetupCloud.vue'
import SetupLaptop from './SetupLaptop.vue'
import { localSetup, type RunOnCards } from './setupFlow'

/**
 * First screen's Cloud / Local pick as the Home's build cards: the machine
 * drawn (the Home's cloud and laptop) in bare metal, no build hue yet since
 * nothing exists; the pick ringed and checked. Copy is today's, word for word. Two takes
 * (UI Playground › Local setup › First screen cards): cards side by side,
 * or stacked rows.
 */
const { variant } = defineProps<{ variant: Exclude<RunOnCards, 'today'> }>()
const model = defineModel<'cloud' | 'local'>({ required: true })

const WAYS = [
  {
    id: 'cloud',
    label: 'Cloud',
    tagline: 'Full power. Instant setup.',
    description: 'Best for <b>powerful GPUs</b> and popular custom nodes, ready anywhere.'
  },
  {
    id: 'local',
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
      :aria-checked="model === w.id"
      @click="model = w.id"
    >
      <span class="mss-way-device">
        <SetupCloud v-if="w.id === 'cloud'" mono />
        <SetupLaptop v-else :os="localSetup.os" />
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
/* The Home's build cards (MarBuildsRow.vue) before any build exists: the
 * machine drawn, a quiet surface, the pick ringed as the flow's radios. */
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
/* Both machines stand on the same floor, flush with the text's left edge:
 * the laptop fills its box, the cloud (drawn smaller, inset) is scaled up
 * from that corner to match. */
/* The devices follow the window: a size between 92 and 124px wide. The
 * cloud fills less of its box than the laptop, so it is drawn up to match. */
.mss-way-device {
  display: flex;
  height: clamp(60px, 5.4vw, 80px);
  flex: none;
  align-items: flex-end;
}
.mss-way .mss-laptop {
  width: clamp(92px, 8.2vw, 124px);
  height: auto;
  margin-left: -4px;
  aspect-ratio: 160 / 104;
}
.mss-way .mss-cloud {
  transform: translate(-20%, 6px) scale(1.4);
  transform-origin: left bottom;
}
.mss-way:not([aria-checked='true']) .mss-way-device {
  opacity: 0.9;
  transition: opacity 160ms ease;
}
.mss-way:hover .mss-way-device {
  opacity: 1;
}
/* Three sizes, one step apart: the name, its one line, the fine print. */
.mss-way-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mss-way-title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 24px;
}
.mss-way-tag {
  color: var(--color-muted-foreground);
  font-size: 14px;
  line-height: 20px;
}
.mss-way-desc {
  margin-top: 12px;
  max-width: 34ch;
  color: var(--color-subtle-foreground);
  font-size: 12.5px;
  line-height: 18px;
  text-wrap: pretty;
}
/* Not picked: a shade down, still readable; the ring and the fill say
 * which one is picked. */
.mss-way:not([aria-checked='true']) .mss-way-title {
  color: color-mix(in oklch, var(--color-base-foreground) 82%, transparent);
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

/* Run on alone (setup.css, .is-alone): the cards are wide, so each reads
 * as a row: the device on the left, the words beside it, the mark top
 * right as before. Here, not in setup.css, so it outranks the card's own
 * rules above. */
.mss-first.is-alone .mss-way {
  flex-direction: row;
  align-items: center;
  gap: 24px;
  padding-right: 56px;
}
.mss-first.is-alone .mss-way-device {
  height: auto;
  align-self: center;
}
.mss-first.is-alone .mss-way .mss-laptop {
  width: clamp(104px, 9vw, 136px);
}
.mss-first.is-alone .mss-way .mss-cloud {
  transform: translate(-16%, 6px) scale(1.4);
}
.mss-first.is-alone .mss-way-desc {
  margin-top: 8px;
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
  .mss-way-device,
  .mss-way-mark {
    transition: none;
  }
}
</style>
