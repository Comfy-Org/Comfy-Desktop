<script setup lang="ts">
import FirstOption from './FirstOption.vue'
import { canvas } from './setupFlow'
import Button from '../../ui/Button.vue'

/**
 * Ten takes on the first screen side by side, live (`?canvas=first`).
 * Each frame is the real 1440×900 screen scaled down, so proportions,
 * rhythm and the pick can be compared as they would ship.
 */
const OPTIONS: { label: string; note: string }[] = [
  {
    label: 'Centred group',
    note: 'One block in the middle; the pick is a ring and a lifted surface.'
  },
  { label: 'Radio in the card', note: 'An inline radio leads each card, no icon.' },
  { label: 'Footer bar', note: 'Larger choice; consent and Continue in a bar along the bottom.' },
  { label: 'Split', note: 'Question and consent left, the choice and Continue right.' },
  { label: 'One list', note: 'Both ways in one grouped list with radios, as Set up.' },
  { label: 'Segmented', note: 'Cloud | Local as a segmented control, details below.' },
  { label: 'Edge bar', note: 'Compact rows; the pick marked by a bar on its edge.' },
  { label: 'Underline', note: 'The pick marked by a line along its foot.' },
  { label: 'Dim the other', note: 'The pick at full strength, the other recedes.' },
  { label: 'Tiles', note: 'Square tiles, a large icon and a corner radio.' }
]
</script>

<template>
  <div class="proto-ui mss-canvas">
    <header class="mss-canvas-head">
      <div>
        <h1>First screen · 10 options</h1>
        <p>Live at real proportions (1440×900, scaled). Click to pick, tick the boxes.</p>
      </div>
      <Button variant="secondary" size="sm" @click="canvas = false">Close</Button>
    </header>
    <div class="mss-canvas-grid">
      <figure v-for="(o, i) in OPTIONS" :key="o.label" class="mss-canvas-item">
        <figcaption>
          <b>{{ i + 1 }} · {{ o.label }}</b> <span>{{ o.note }}</span>
        </figcaption>
        <div class="mss-canvas-frame">
          <FirstOption :option="i + 1" />
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
  grid-template-columns: repeat(2, 648px);
  gap: 40px 32px;
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
/* The real screen at 1440×900, scaled to 648×405 (0.45). */
.mss-canvas-frame {
  position: relative;
  width: 648px;
  height: 405px;
  overflow: hidden;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.08);
}
.mss-canvas-frame > .fo {
  transform: scale(0.45);
  transform-origin: 0 0;
}
</style>
