<script setup lang="ts">
import { computed } from 'vue'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import { thumb, type Template } from '../../mock'
import type { TemplateStyle } from './templateStyle'

/**
 * A template picture carrying Comfy's brand the way Magnific carries its
 * own: the output first, the brand in one small touch. Each style is a
 * different touch; brand colour (Volt #F0FF41, Deep Aubergine #2a1838,
 * paper) lives here in the imagery, never in the UI around the card.
 * No hover zoom: hover only reveals (colour, the after side).
 */
const { t, kind } = defineProps<{ t: Template; kind: Exclude<TemplateStyle, 'photo'> }>()

const src = computed(() => thumb(t.id))
const CATEGORY = { image: 'Image', video: 'Video', '3d': '3D', audio: 'Audio' } as const
</script>

<template>
  <!-- Signed: a small C mark in the corner, like a print's signature. -->
  <div v-if="kind === 'mark'" class="bt">
    <img :src alt="" class="bt-img" loading="lazy" />
    <span class="bt-sign" aria-hidden="true"><ComfyCLogo :size="15" /></span>
  </div>

  <!-- Volt edge: one thin Volt rule along the foot of the picture. -->
  <div v-else-if="kind === 'volt'" class="bt">
    <img :src alt="" class="bt-img" loading="lazy" />
    <span class="bt-volt" aria-hidden="true" />
  </div>

  <!-- Duotone: aubergine shadows, paper lights; the real colour on hover. -->
  <div v-else-if="kind === 'duotone'" class="bt bt-duo">
    <img :src alt="" class="bt-img bt-duo-mono" loading="lazy" />
    <span class="bt-duo-dark" aria-hidden="true" />
    <span class="bt-duo-light" aria-hidden="true" />
    <img :src alt="" class="bt-img bt-duo-color" loading="lazy" />
  </div>

  <!-- Print: the photo on a warm paper mat with a tiny colophon. -->
  <div v-else-if="kind === 'mat'" class="bt bt-mat">
    <img :src alt="" class="bt-mat-img" loading="lazy" />
    <div class="bt-mat-foot">
      <span class="bt-mat-brand"><ComfyCLogo :size="9" />Comfy</span>
      <span>{{ CATEGORY[t.category] }}</span>
    </div>
  </div>

  <!-- Before / after: a quiet grey "before", the output after a Volt line. -->
  <div v-else class="bt bt-split">
    <img :src alt="" class="bt-img bt-split-before" loading="lazy" />
    <img :src alt="" class="bt-img bt-split-after" loading="lazy" />
    <span class="bt-split-line" aria-hidden="true" />
  </div>
</template>

<style scoped>
.bt {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.bt-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Signed */
.bt-sign {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 1;
  display: grid;
  color: #fff;
  opacity: 0.92;
  filter: drop-shadow(0 1px 3px rgb(0 0 0 / 0.45));
}
.bt:has(.bt-sign)::after {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 100% 100%, rgb(0 0 0 / 0.3), transparent 32%);
  content: '';
  pointer-events: none;
}

/* Volt edge */
.bt-volt {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  background: #f0ff41;
}

/* Duotone: a grey photo, aubergine lifted into its shadows, paper pressed
   into its lights; the colour photo fades in over it on hover. */
.bt-duo-mono {
  filter: grayscale(1) contrast(1.25) brightness(1.08);
}
.bt-duo-dark,
.bt-duo-light {
  position: absolute;
  inset: 0;
}
.bt-duo-dark {
  background: #2a1838;
  mix-blend-mode: lighten;
}
.bt-duo-light {
  background: #f3eee4;
  mix-blend-mode: multiply;
}
.bt-duo-color {
  opacity: 0;
  transition: opacity 400ms cubic-bezier(0.2, 0, 0, 1);
}
.group:hover .bt-duo-color,
.group:focus-visible .bt-duo-color {
  opacity: 1;
}

/* Print */
.bt-mat {
  display: flex;
  flex-direction: column;
  gap: 6%;
  padding: 6% 7% 0;
  background: #f3eee4;
}
.bt-mat-img {
  width: 100%;
  min-height: 0;
  flex: 1;
  border-radius: 2px;
  object-fit: cover;
  box-shadow: 0 1px 2px rgb(42 24 56 / 0.18);
}
.bt-mat-foot {
  display: flex;
  height: 13%;
  align-items: flex-start;
  justify-content: space-between;
  color: rgb(42 24 56 / 0.62);
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.08em;
  line-height: 1;
  text-transform: uppercase;
}
.bt-mat-brand {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #2a1838;
}

/* Before / after: the after side opens wider on hover. */
.bt-split {
  --split: 50%;
}
.group:hover .bt-split,
.group:focus-visible .bt-split {
  --split: 30%;
}
.bt-split-before {
  filter: grayscale(1) contrast(0.85) brightness(1.08);
}
.bt-split-after {
  clip-path: inset(0 0 0 var(--split));
  transition: clip-path 500ms cubic-bezier(0.2, 0, 0, 1);
}
.bt-split-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--split);
  width: 2px;
  margin-left: -1px;
  background: #f0ff41;
  transition: left 500ms cubic-bezier(0.2, 0, 0, 1);
}
.bt-split-line::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: #f0ff41;
  content: '';
  transform: translate(-50%, -50%);
}
</style>
