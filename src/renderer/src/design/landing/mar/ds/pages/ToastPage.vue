<script setup lang="ts">
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-vue-next'
import portraitGarden from '../../assets/portrait-garden.jpg'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import '../../pages/MarUndoToast.vue'

/** The toast, still, in its tones: over a picture, over the page, in place. */
const TONES = [
  {
    id: 'success',
    label: 'Success',
    icon: CircleCheck,
    text: 'Restored',
    undo: true
  },
  { id: 'info', label: 'Info', icon: Info, text: 'Stopped', undo: true },
  { id: 'warning', label: 'Warning', icon: TriangleAlert, text: 'Not enough space', undo: false },
  { id: 'error', label: 'Error', icon: CircleX, text: 'Couldn’t log in', undo: false }
]
</script>

<template>
  <div class="proto-ui ds-toast-page">
    <Section title="Over a picture" note="The tone over a blurred card. No border.">
      <Cells :min="300">
        <Cell v-for="t in TONES" :key="t.id" :label="t.label" fill>
          <div class="ds-toast-photo" :style="{ backgroundImage: `url(${portraitGarden})` }">
            <div class="mar-undo is-still" :class="`is-${t.id}`">
              <component :is="t.icon" :size="16" class="mar-undo-icon" />
              <span class="mar-undo-text">{{ t.text }}</span>
              <button v-if="t.undo" type="button" class="mar-undo-btn">Undo</button>
              <X :size="13" class="ds-toast-x" />
            </div>
          </div>
        </Cell>
      </Cells>
    </Section>
    <Section
      title="Application"
      note="Top right, under the title bar. One at a time. Only when you stay on the page and something changes. Notes of the prototype itself, standing in for what isn’t built, stay in a plain white toast and aren’t part of the product."
    >
      <div class="ds-toast-window" :style="{ backgroundImage: `url(${portraitGarden})` }">
        <div class="ds-toast-bar" />
        <div class="mar-undo is-still is-success ds-toast-placed">
          <CircleCheck :size="16" class="mar-undo-icon" />
          <span class="mar-undo-text">My Local 1 is on ComfyUI v0.37.6</span>
          <button type="button" class="mar-undo-btn">Undo</button>
          <X :size="13" class="ds-toast-x" />
        </div>
      </div>
    </Section>
    <Section title="Over the page">
      <Cells :min="300">
        <Cell v-for="t in TONES" :key="t.id" :label="t.label" fill>
          <div class="ds-toast-plain">
            <div class="mar-undo is-still" :class="`is-${t.id}`">
              <component :is="t.icon" :size="16" class="mar-undo-icon" />
              <span class="mar-undo-text">{{ t.text }}</span>
              <button v-if="t.undo" type="button" class="mar-undo-btn">Undo</button>
              <X :size="13" class="ds-toast-x" />
            </div>
          </div>
        </Cell>
      </Cells>
    </Section>
  </div>
</template>

<style>
.ds-toast-page {
  display: flex;
  flex-direction: column;
  gap: 40px;
}
.ds-toast-photo,
.ds-toast-plain {
  display: grid;
  height: 140px;
  place-items: center;
  border-radius: 8px;
  background-position: center 30%;
  background-size: cover;
}
.ds-toast-plain {
  background-color: var(--color-content-background);
}
.ds-toast-x {
  flex: none;
  margin: 0 7px 0 2px;
  color: var(--color-muted-foreground);
}
.ds-toast-window {
  position: relative;
  height: 340px;
  overflow: hidden;
  border-radius: 12px;
  background-position: center 30%;
  background-size: cover;
}
.ds-toast-bar {
  height: 44px;
  background: var(--color-titlebar-background);
}
:root .proto-ui.proto-ui.proto-ui .mar-undo.is-still.ds-toast-placed {
  position: absolute;
  top: 56px;
  right: 20px;
}
</style>
