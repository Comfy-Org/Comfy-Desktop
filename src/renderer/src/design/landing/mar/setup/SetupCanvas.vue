<script setup lang="ts">
import { reactive } from 'vue'
import ChoiceCard from '../../../../components/ChoiceCard.vue'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import RunOnCards from './RunOnCards.vue'
import { canvas, type RunOnCards as Variant } from './setupFlow'
import Button from '../../ui/Button.vue'

/**
 * The first screen's card options side by side, live (`?canvas=first`):
 * each frame is the real screen at a smaller scale, so the light, the
 * motion and the picks can be compared without switching tweaks.
 */
const FRAMES: { id: Variant; label: string; note: string }[] = [
  { id: 'glow', label: 'Glow', note: 'Icon and light per way; the pick fills with its hue.' },
  { id: 'row', label: 'Row', note: "The Home's start rows, with a radio on the right." },
  { id: 'today', label: 'Today', note: "Desktop's ChoiceCard, as shipped." }
]
const pick = reactive<Record<Variant, 'cloud' | 'local'>>({
  glow: 'local',
  row: 'local',
  today: 'local'
})
</script>

<template>
  <div class="proto-ui mss-canvas">
    <header class="mss-canvas-head">
      <div>
        <h1>First screen · card options</h1>
        <p>Live. Click the cards: the light follows the pick.</p>
      </div>
      <Button variant="secondary" size="sm" @click="canvas = false">Close</Button>
    </header>
    <div class="mss-canvas-grid">
      <figure v-for="f in FRAMES" :key="f.id" class="mss-canvas-item">
        <figcaption>
          <b>{{ f.label }}</b> <span>{{ f.note }}</span>
        </figcaption>
        <div class="mss-first is-canvas">
          <div class="mss-first-frame">
            <div class="mss-ambient" :class="`is-${pick[f.id]}`"></div>
            <ComfyCLogo class="mss-first-mark" />
            <div class="mss-first-hero">
              <h2 class="mss-first-title">How do you want to run Comfy?</h2>
              <p class="mss-first-lead">
                Choose the setup that fits how you work. You can switch later.
              </p>
              <RunOnCards v-if="f.id !== 'today'" v-model="pick[f.id]" :variant="f.id" />
              <div v-else class="mss-first-cards" role="radiogroup" data-no-pill>
                <ChoiceCard
                  selectable
                  :selected="pick.today === 'cloud'"
                  label="Cloud"
                  tagline="Full power. Instant setup."
                  description="Best for **most users** who want powerful GPUs and popular custom nodes, ready anywhere."
                  @click="pick.today = 'cloud'"
                />
                <ChoiceCard
                  selectable
                  :selected="pick.today === 'local'"
                  label="Local"
                  tagline="Full control. Your hardware."
                  description="Best for people who want **full manual control** with versions, custom nodes, and offline workflows."
                  @click="pick.today = 'local'"
                />
              </div>
            </div>
          </div>
        </div>
      </figure>
    </div>
  </div>
</template>

<style>
.mss-canvas {
  position: fixed;
  inset: 0;
  z-index: 90;
  overflow: auto;
  padding: 40px;
  background: oklch(0.16 0.003 285);
  color: var(--color-muted-foreground);
}
.mss-canvas-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.mss-canvas-head h1 {
  color: var(--color-base-foreground);
  font-size: var(--text-title, 24px);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.mss-canvas-head p {
  margin-top: 6px;
  font-size: var(--text-ui);
}
.mss-canvas-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(560px, 1fr));
  gap: 32px;
  margin-top: 28px;
}
.mss-canvas-item figcaption {
  margin-bottom: 10px;
  font-size: var(--text-ui);
}
.mss-canvas-item figcaption b {
  margin-right: 6px;
  color: var(--color-base-foreground);
  font-weight: 600;
}
/* The real first screen, framed and scaled into the canvas. */
.mss-first.is-canvas {
  position: relative;
  inset: auto;
  z-index: auto;
  height: 560px;
  border-radius: 14px;
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.08);
  overflow: hidden;
}
.mss-first.is-canvas .mss-first-frame {
  overflow: hidden;
  padding: 56px 40px 28px;
}
</style>
