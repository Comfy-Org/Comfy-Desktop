<script setup lang="ts">
import { Check, Cloud, Laptop } from 'lucide-vue-next'
import type { RunOnCards } from './setupFlow'

/**
 * First screen's Cloud / Local pick in the Home's card language: each way
 * carries its own light (cool for Cloud, warm for Local) that wakes up on
 * hover and fills the card when picked. Copy is today's, word for word.
 * Two takes (UI Playground › Local setup › First screen cards): glow, row.
 */
const { variant } = defineProps<{ variant: Exclude<RunOnCards, 'today'> }>()
const model = defineModel<'cloud' | 'local'>({ required: true })

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
</script>

<template>
  <div
    class="mss-ways"
    :class="`is-${variant}`"
    role="radiogroup"
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
      <span class="mss-way-light" aria-hidden="true"></span>
      <span class="mss-way-icon"><component :is="w.icon" :size="20" :stroke-width="1.75" /></span>
      <span class="mss-way-text">
        <span class="mss-way-title">{{ w.label }}</span>
        <span class="mss-way-tag">{{ w.tagline }}</span>
        <!-- eslint-disable-next-line vue/no-v-html -- static copy, bold spans only -->
        <span class="mss-way-desc" v-html="w.description"></span>
      </span>
      <span class="mss-way-mark" aria-hidden="true"><Check :size="12" :stroke-width="3" /></span>
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
.mss-way {
  --hue: oklch(0.68 0.15 265);
  --hue-2: oklch(0.72 0.12 210);
  position: relative;
  isolation: isolate;
  display: flex;
  overflow: hidden;
  flex-direction: column;
  align-items: flex-start;
  gap: 18px;
  padding: 20px;
  border-radius: 16px;
  background: oklch(0.6 0 0 / 0.06);
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.08);
  color: var(--color-base-foreground);
  text-align: left;
  cursor: pointer;
  outline: none;
  transition:
    box-shadow 260ms ease,
    background-color 260ms ease,
    transform 400ms cubic-bezier(0.19, 1, 0.22, 1);
}
.mss-way.is-local {
  --hue: oklch(0.74 0.14 50);
  --hue-2: oklch(0.7 0.14 15);
}
.mss-way:hover {
  background: oklch(0.6 0 0 / 0.09);
  transform: translateY(-2px);
}
.mss-way:active {
  transform: translateY(0) scale(0.99);
}
.mss-way:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mss-way[aria-checked='true'] {
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--hue) 70%, white),
    0 18px 50px -24px var(--hue);
}

/* The way's light: two soft blobs in its hues, drifting in the corner.
 * Faint at rest, brighter on hover, full when picked. */
.mss-way-light {
  position: absolute;
  inset: -40% -20% 30% -30%;
  z-index: -1;
  background:
    radial-gradient(closest-side at 30% 40%, var(--hue), transparent),
    radial-gradient(closest-side at 70% 30%, var(--hue-2), transparent 80%);
  filter: blur(24px);
  opacity: 0.12;
  pointer-events: none;
  transition: opacity 500ms ease;
  animation: mss-way-drift 9s ease-in-out infinite alternate;
}
.mss-way:hover .mss-way-light {
  opacity: 0.22;
}
.mss-way[aria-checked='true'] .mss-way-light {
  opacity: 0.42;
}
@keyframes mss-way-drift {
  to {
    transform: translate(8%, 6%) rotate(8deg) scale(1.08);
  }
}

.mss-way-icon {
  display: inline-flex;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  background: linear-gradient(
    150deg,
    color-mix(in oklch, var(--hue) 34%, transparent),
    color-mix(in oklch, var(--hue-2) 14%, transparent)
  );
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--hue) 40%, transparent);
  color: color-mix(in oklch, var(--hue) 35%, white);
  transition: transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.mss-way:hover .mss-way-icon,
.mss-way[aria-checked='true'] .mss-way-icon {
  transform: translateY(-2px) rotate(-4deg);
}
.mss-way-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mss-way-title {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.mss-way-tag {
  color: color-mix(in oklch, var(--hue) 45%, var(--color-muted-foreground));
  font-size: 12px;
  font-weight: 500;
}
.mss-way-desc {
  margin-top: 8px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  line-height: var(--text-ui--line-height);
  text-wrap: pretty;
}
.mss-way-desc b {
  color: var(--color-muted-foreground);
  font-weight: 500;
}
/* Picked: a white disc with a check, top right; it pops in. */
.mss-way-mark {
  position: absolute;
  top: 16px;
  right: 16px;
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 4px 12px -4px rgb(0 0 0 / 0.5);
  color: #111;
  opacity: 0;
  transform: scale(0.5);
  transition:
    opacity 160ms ease,
    transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.mss-way[aria-checked='true'] .mss-way-mark {
  opacity: 1;
  transform: scale(1);
}

/* Row: one line per way, the Home's "For ComfyUI users" rows grown to
 * carry the description; the mark sits as a radio on the right. */
.mss-ways.is-row {
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}
.mss-ways.is-row .mss-way {
  flex-direction: row;
  align-items: center;
  gap: 16px;
  padding: 16px 56px 16px 16px;
}
.mss-ways.is-row .mss-way-desc {
  margin-top: 4px;
}
.mss-ways.is-row .mss-way-mark {
  top: 50%;
  margin-top: -11px;
}
.mss-ways.is-row .mss-way:not([aria-checked='true']) .mss-way-mark {
  opacity: 1;
  transform: scale(1);
  background: transparent;
  box-shadow: inset 0 0 0 1.5px oklch(1 0 0 / 0.25);
  color: transparent;
}

/* The prototype's control reset (ui/tokens.css) reverts a button's box;
 * restated here at its own specificity, as MarSeg does. */
:root .proto-ui .mss-ways .mss-way {
  width: auto;
  height: auto;
  padding: 20px;
  border-radius: 16px;
  background: oklch(0.6 0 0 / 0.06);
}
:root .proto-ui .mss-ways .mss-way:hover {
  background: oklch(0.6 0 0 / 0.09);
}
:root .proto-ui .mss-ways.is-row .mss-way {
  padding: 16px 56px 16px 16px;
}

@media (prefers-reduced-motion: reduce) {
  .mss-way,
  .mss-way-icon,
  .mss-way-mark {
    transition: none;
  }
  .mss-way-light {
    animation: none;
  }
}
</style>
