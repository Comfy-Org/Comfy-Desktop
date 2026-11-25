<script setup lang="ts">
import { reactive } from 'vue'
import { Cloud, Laptop } from 'lucide-vue-next'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import Button from '../../ui/Button.vue'
import Checkbox from '../../ui/Checkbox.vue'

/**
 * One take on the first screen, at the real window size (1440×900), for
 * the canvas (SetupCanvas.vue). Same copy, options and consent defaults as
 * today; the takes differ in proportions, vertical rhythm, how the pick is
 * marked and where consent and Continue sit. Each keeps its own state.
 */
const { option } = defineProps<{ option: number }>()

const WAYS = [
  {
    id: 'cloud',
    icon: Cloud,
    label: 'Cloud',
    tagline: 'Full power. Instant setup.',
    description:
      'Best for <b>most users</b> who want powerful GPUs and popular custom nodes, ready anywhere.'
  },
  {
    id: 'local',
    icon: Laptop,
    label: 'Local',
    tagline: 'Full control. Your hardware.',
    description:
      'Best for people who want <b>full manual control</b> with versions, custom nodes, and offline workflows.'
  }
] as const

const s = reactive({
  runOn: 'local' as 'cloud' | 'local',
  express: false,
  terms: false,
  usage: true,
  beta: true
})
const picked = (id: string): boolean => s.runOn === id
const detail = (): (typeof WAYS)[number] => WAYS.find((w) => w.id === s.runOn) ?? WAYS[1]
</script>

<template>
  <div class="proto-ui fo" :class="`v${option}`">
    <div class="fo-amb" aria-hidden="true"></div>
    <ComfyCLogo class="fo-mark" />
    <div class="fo-main">
      <header class="fo-head">
        <h1 class="fo-title">How do you want to run Comfy?</h1>
        <p class="fo-lead">Choose the setup that fits how you work. You can switch later.</p>
      </header>

      <div
        class="fo-ways"
        role="radiogroup"
        data-no-pill
        aria-label="How do you want to run Comfy?"
      >
        <div
          v-for="w in WAYS"
          :key="w.id"
          class="fo-card"
          role="radio"
          tabindex="0"
          :aria-checked="picked(w.id)"
          @click="s.runOn = w.id"
          @keydown.enter.space.prevent="s.runOn = w.id"
        >
          <span class="fo-radio" aria-hidden="true"></span>
          <span class="fo-icon"><component :is="w.icon" :size="17" /></span>
          <span class="fo-text">
            <span class="fo-name">{{ w.label }}</span>
            <span class="fo-tag">{{ w.tagline }}</span>
            <!-- eslint-disable-next-line vue/no-v-html -- static copy, bold spans only -->
            <span class="fo-desc" v-html="w.description"></span>
          </span>
          <span class="fo-bar" aria-hidden="true"></span>
        </div>
      </div>

      <!-- Option 6: the pick's details under a segmented control. -->
      <div v-if="option === 6" class="fo-detail">
        <span class="fo-tag">{{ detail().tagline }}</span>
        <!-- eslint-disable-next-line vue/no-v-html -- static copy, bold spans only -->
        <span class="fo-desc" v-html="detail().description"></span>
      </div>

      <label class="fo-check fo-express" :class="s.runOn !== 'local' && 'is-off'">
        <Checkbox v-model="s.express" />
        <span>
          <span class="fo-strong">Express Install with recommended settings</span>
          <span class="fo-hint" :class="!s.express && 'is-hidden'"
            >Detected: Apple Silicon (MPS) - if that's not your hardware, uncheck Express</span
          >
        </span>
      </label>

      <div class="fo-foot">
        <div class="fo-consent">
          <label class="fo-check">
            <Checkbox v-model="s.terms" />
            <span>I agree to the <u>EULA</u> and <u>Terms of Service</u>.</span>
          </label>
          <label class="fo-check">
            <Checkbox v-model="s.usage" />
            <span>Help improve Comfy by sharing anonymous usage data. <u>Learn more</u></span>
          </label>
          <label class="fo-check">
            <Checkbox v-model="s.beta" :disabled="!s.usage" />
            <span>Opt in to beta features and help test what ships next</span>
          </label>
        </div>
        <Button variant="primary" size="lg" class="fo-go" :disabled="!s.terms">Continue</Button>
      </div>
    </div>
  </div>
</template>

<style>
/* ---- Base: the takeover at 1440×900, the Home's neutral style ---- */
.fo {
  --ink: var(--color-base-foreground);
  --soft: color-mix(in oklch, var(--ink) 3%, transparent);
  --soft-2: color-mix(in oklch, var(--ink) 6%, transparent);
  --line: color-mix(in oklch, var(--ink) 8%, transparent);
  --ring: color-mix(in oklch, var(--ink) 55%, transparent);
  position: relative;
  isolation: isolate;
  display: flex;
  width: 1440px;
  height: 900px;
  overflow: hidden;
  background: oklch(0.12 0.003 285);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  line-height: var(--text-ui--line-height);
}
.fo-amb {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: radial-gradient(
    ellipse 55% 85% at 50% -15%,
    color-mix(in oklch, var(--ink) 7%, transparent),
    transparent 70%
  );
}
.fo-mark {
  position: absolute;
  top: 24px;
  left: 24px;
  width: 28px;
  height: 28px;
  color: var(--ink);
}
.fo-main {
  display: flex;
  width: 640px;
  flex-direction: column;
  margin: auto;
}
.fo-title {
  color: var(--ink);
  font-size: var(--text-title, 24px);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.fo-lead {
  margin-top: 6px;
}
.fo-ways {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 28px;
}
.fo-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  padding: 18px;
  border-radius: 16px;
  background: var(--soft);
  box-shadow: inset 0 0 0 1px var(--line);
  cursor: pointer;
  outline: none;
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease,
    opacity 200ms ease;
}
.fo-card:hover {
  background: var(--soft-2);
}
.fo-card:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.fo-card[aria-checked='true'] {
  box-shadow: inset 0 0 0 1px var(--ring);
}
.fo-radio,
.fo-bar {
  display: none;
}
.fo-icon {
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in oklch, var(--ink) 7%, transparent);
  color: var(--color-muted-foreground);
}
.fo-card[aria-checked='true'] .fo-icon {
  color: var(--ink);
}
.fo-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fo-name {
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.fo-tag {
  color: var(--color-muted-foreground);
}
.fo-desc {
  margin-top: 6px;
  color: var(--color-subtle-foreground);
  text-wrap: pretty;
}
.fo-desc b {
  color: var(--color-muted-foreground);
  font-weight: 500;
}
.fo-check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}
.fo-check [role='checkbox']:not([data-state='checked']) {
  border-color: color-mix(in oklch, var(--ink) 28%, transparent);
  background: transparent;
}
.fo-check > span {
  padding-top: 1px;
}
.fo-express > span {
  display: grid;
}
.fo-strong {
  color: var(--ink);
}
.fo-hint {
  color: var(--color-subtle-foreground);
}
.fo-hint.is-hidden,
.fo-express.is-off {
  visibility: hidden;
}
.fo-express {
  margin-top: 20px;
}
.fo-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-top: 36px;
  padding-top: 20px;
  box-shadow: inset 0 1px 0 var(--line);
}
.fo-consent {
  display: grid;
  gap: 8px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  line-height: 16px;
}
.fo-consent [role='checkbox'] {
  width: 16px;
  height: 16px;
}
.fo-consent u {
  color: var(--color-muted-foreground);
  text-decoration-color: color-mix(in oklch, currentColor 40%, transparent);
  text-underline-offset: 3px;
}

/* ---- 1 · Centred group: one block in the middle, consent right under
 *      the choice; the pick is a brighter ring and a lifted surface. ---- */
.v1 .fo-card[aria-checked='true'] {
  background: var(--soft-2);
}
.v1 .fo-card:not([aria-checked='true']) .fo-name {
  color: var(--color-muted-foreground);
}

/* ---- 2 · Radio in the card: an inline radio leads each card, no icon;
 *      consent and Continue under a hairline. ---- */
.v2 .fo-card {
  display: grid;
  grid-template-columns: 18px 1fr;
  align-items: start;
  gap: 12px;
}
.v2 .fo-icon {
  display: none;
}
.v2 .fo-radio {
  display: block;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1.5px color-mix(in oklch, var(--ink) 30%, transparent);
}
.v2 .fo-card[aria-checked='true'] .fo-radio {
  box-shadow: inset 0 0 0 5px var(--ink);
}

/* ---- 3 · Footer bar: a wider, taller choice; consent and Continue in a
 *      bar along the bottom of the window, as a wizard footer. ---- */
.v3 .fo-main {
  width: 760px;
  margin-bottom: auto;
  padding-top: 170px;
}
.v3 .fo-title {
  font-size: 32px;
  line-height: 1.15;
}
.v3 .fo-ways {
  margin-top: 36px;
}
.v3 .fo-card {
  min-height: 236px;
  justify-content: space-between;
  padding: 22px;
}
.v3 .fo-card[aria-checked='true'] {
  background: var(--soft-2);
}
.v3 .fo-foot {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  margin: 0;
  padding: 18px calc((1440px - 760px) / 2);
  background: oklch(0.14 0.003 285 / 0.9);
}

/* ---- 4 · Split: the question and consent on the left, the choice on
 *      the right; Continue closes the right column. ---- */
.v4 .fo-main {
  display: grid;
  width: 1000px;
  grid-template-columns: 1fr 1.15fr;
  grid-template-rows: auto auto 1fr;
  column-gap: 64px;
}
.v4 .fo-head {
  grid-area: 1 / 1;
  padding-top: 8px;
}
.v4 .fo-title {
  font-size: 32px;
  line-height: 1.15;
}
.v4 .fo-ways {
  grid-area: 1 / 2 / 3 / 3;
  grid-template-columns: 1fr;
  margin: 0;
}
.v4 .fo-card {
  flex-direction: row;
  align-items: center;
}
.v4 .fo-express {
  grid-area: 3 / 2;
  margin-top: 16px;
}
.v4 .fo-foot {
  display: contents;
}
.v4 .fo-consent {
  grid-area: 2 / 1 / 4 / 2;
  align-self: end;
}
.v4 .fo-go {
  grid-area: 4 / 2;
  justify-self: end;
  margin-top: 28px;
}

/* ---- 5 · One list: both ways in one grouped list, a radio at the left,
 *      as Set up's summary; Continue spans the column. ---- */
.v5 .fo-ways {
  grid-template-columns: 1fr;
  gap: 0;
  overflow: hidden;
  border-radius: 16px;
  background: var(--soft);
  box-shadow: inset 0 0 0 1px var(--line);
}
.v5 .fo-card {
  flex-direction: row;
  align-items: center;
  gap: 16px;
  border-radius: 0;
  background: none;
  box-shadow: none;
}
.v5 .fo-card + .fo-card {
  box-shadow: inset 0 1px 0 var(--line);
}
.v5 .fo-card[aria-checked='true'] {
  background: var(--soft-2);
}
.v5 .fo-radio {
  display: block;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1.5px color-mix(in oklch, var(--ink) 30%, transparent);
}
.v5 .fo-card[aria-checked='true'] .fo-radio {
  box-shadow: inset 0 0 0 5px var(--ink);
}
.v5 .fo-foot {
  flex-direction: column;
  align-items: stretch;
}
.v5 .fo-go {
  width: 100%;
}

/* ---- 6 · Segmented: Cloud | Local as a large segmented control, the
 *      pick's tagline and description in one panel below it. ---- */
.v6 .fo-ways {
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  background: var(--soft);
  box-shadow: inset 0 0 0 1px var(--line);
}
.v6 .fo-card {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: none;
  box-shadow: none;
}
.v6 .fo-card[aria-checked='true'] {
  background: color-mix(in oklch, var(--ink) 10%, transparent);
}
.v6 .fo-icon {
  width: auto;
  height: auto;
  background: none;
}
.v6 .fo-card .fo-tag,
.v6 .fo-card .fo-desc {
  display: none;
}
.v6 .fo-detail {
  display: grid;
  gap: 2px;
  margin-top: 12px;
  padding: 18px;
  border-radius: 14px;
  background: var(--soft);
  box-shadow: inset 0 0 0 1px var(--line);
}

/* ---- 7 · Rows with an edge: compact rows, the pick marked by a bar on
 *      its left edge; consent and Continue pinned to the bottom. ---- */
.v7 .fo-main {
  width: 600px;
}
.v7 .fo-ways {
  grid-template-columns: 1fr;
  gap: 8px;
}
.v7 .fo-card {
  flex-direction: row;
  align-items: center;
  gap: 16px;
  overflow: hidden;
  padding-left: 22px;
}
.v7 .fo-bar {
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 0;
  display: block;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--ink);
  opacity: 0;
  transform: scaleY(0.4);
  transition:
    opacity 160ms ease,
    transform 300ms cubic-bezier(0.19, 1, 0.22, 1);
}
.v7 .fo-card[aria-checked='true'] .fo-bar {
  opacity: 1;
  transform: none;
}
.v7 .fo-card[aria-checked='true'] {
  box-shadow: inset 0 0 0 1px var(--line);
  background: var(--soft-2);
}
.v7 .fo-foot {
  position: absolute;
  right: 0;
  bottom: 32px;
  left: 0;
  width: 600px;
  margin: 0 auto;
}

/* ---- 8 · Underline: the pick marked by a line along the card's foot;
 *      consent then Continue, one column, Continue left. ---- */
.v8 .fo-card {
  overflow: hidden;
}
.v8 .fo-bar {
  position: absolute;
  right: 18px;
  bottom: 0;
  left: 18px;
  display: block;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--ink);
  opacity: 0;
  transform: scaleX(0.3);
  transition:
    opacity 160ms ease,
    transform 360ms cubic-bezier(0.19, 1, 0.22, 1);
}
.v8 .fo-card[aria-checked='true'] {
  box-shadow: inset 0 0 0 1px var(--line);
  background: var(--soft-2);
}
.v8 .fo-card[aria-checked='true'] .fo-bar {
  opacity: 1;
  transform: none;
}
.v8 .fo-foot {
  flex-direction: column;
  align-items: flex-start;
  gap: 20px;
}

/* ---- 9 · Dim the other: the pick at full strength with its ring, the
 *      other way recedes; consent in one row of three under the cards. ---- */
.v9 .fo-main {
  width: 720px;
}
.v9 .fo-card {
  min-height: 200px;
  padding: 22px;
}
.v9 .fo-card:not([aria-checked='true']) {
  opacity: 0.45;
}
.v9 .fo-card:not([aria-checked='true']):hover {
  opacity: 0.75;
}
.v9 .fo-card[aria-checked='true'] {
  background: var(--soft-2);
}
.v9 .fo-foot {
  flex-direction: column;
  align-items: stretch;
  gap: 20px;
}
.v9 .fo-consent {
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.v9 .fo-go {
  align-self: flex-end;
}

/* ---- 10 · Tiles: square tiles, a large icon, a radio dot in the tile's
 *       corner shares the row with the name; content sits a bit above
 *       centre, consent and Continue under a hairline. ---- */
.v10 .fo-main {
  margin-top: 150px;
}
.v10 .fo-card {
  aspect-ratio: 1 / 0.82;
  justify-content: space-between;
  padding: 22px;
}
.v10 .fo-icon {
  width: 52px;
  height: 52px;
  border-radius: 15px;
}
.v10 .fo-icon svg {
  width: 22px;
  height: 22px;
}
.v10 .fo-radio {
  position: absolute;
  top: 22px;
  right: 22px;
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1.5px color-mix(in oklch, var(--ink) 30%, transparent);
}
.v10 .fo-card[aria-checked='true'] .fo-radio {
  box-shadow: inset 0 0 0 5px var(--ink);
}
.v10 .fo-card[aria-checked='true'] {
  background: var(--soft-2);
}
</style>
