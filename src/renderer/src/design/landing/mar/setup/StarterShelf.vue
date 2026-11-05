<script setup lang="ts">
import { ArrowDownToLine, Play } from 'lucide-vue-next'
import { toast } from '../../useProto'
import { STARTERS, type Starter } from './setupFlow'
import { imgUrl } from './canvasData'
import zitThumb from '../assets/templates/image_z_image_turbo.webp'
import minimaxThumb from '../assets/templates/video_minimax_h3_i2v.webp'

/**
 * The starter workflows, on the Home after the first local install: the one
 * place they're offered now that Set up no longer asks. In the look of the
 * Home's examples (userStates/ExampleRow.vue). Each says where it runs:
 * Local with the models it downloads on first open, or Cloud, nothing to
 * download. The recommended one of each type, and one that runs on Cloud.
 */
type Shelf = Starter & { kind: string; src: string }
const pick = (k: keyof typeof STARTERS, id: string, kind: string, src?: string): Shelf => {
  const s = STARTERS[k].find((x) => x.id === id) as Starter
  return { ...s, kind, src: src ?? imgUrl(s.img) }
}
const SHELF: Shelf[] = [
  pick('image', 'zit', 'Image', zitThumb),
  pick('video', 'minimax', 'Video', minimaxThumb),
  pick('3d', 'triposplat', '3D'),
  pick('audio', 'sa3', 'Audio'),
  pick('image', 'seedream', 'Image')
]
const where = (s: Starter): string => (s.credits ? 'Cloud' : `Local · ${s.gb} GB`)
function open(s: Shelf): void {
  toast(
    s.credits
      ? `Opening ${s.title} on Comfy Cloud`
      : `Downloading ${s.gb} GB of models. ${s.title} opens when they're ready.`
  )
}
</script>

<template>
  <div class="mss-shelf" role="list" aria-label="Starter workflows">
    <button
      v-for="s in SHELF"
      :key="s.id"
      type="button"
      role="listitem"
      class="mss-shelf-card"
      @click="open(s)"
    >
      <img :src="s.src" alt="" loading="lazy" />
      <span class="mss-shelf-chip">{{ where(s) }}</span>
      <span class="mss-shelf-label">
        <span>{{ s.title }}</span>
        <span class="mss-shelf-kind">{{ s.kind }}</span>
      </span>
      <span class="mss-shelf-run"
        ><component :is="s.credits ? Play : ArrowDownToLine" :size="12" />{{
          s.credits ? 'Run' : 'Get'
        }}</span
      >
    </button>
  </div>
</template>

<style scoped>
.mss-shelf {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.mss-shelf-card img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 600ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mss-shelf-card::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgb(0 0 0 / 0.72), transparent 55%);
  content: '';
}
.mss-shelf-chip {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
  color: rgb(255 255 255 / 0.92);
  font-size: 11px;
}
.mss-shelf-label {
  position: absolute;
  right: 14px;
  bottom: 14px;
  left: 14px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
  text-align: left;
  transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mss-shelf-kind {
  color: rgb(255 255 255 / 0.65);
  font-size: 12px;
  font-weight: 400;
}
.mss-shelf-run {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--radius-control);
  background: #fff;
  color: #111;
  font-size: 12px;
  font-weight: 600;
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity 200ms ease,
    transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mss-shelf-card:hover img,
.mss-shelf-card:focus-visible img {
  transform: scale(1.04);
}
.mss-shelf-card:hover .mss-shelf-run,
.mss-shelf-card:focus-visible .mss-shelf-run {
  opacity: 1;
  transform: none;
}
.mss-shelf-card:hover .mss-shelf-label,
.mss-shelf-card:focus-visible .mss-shelf-label {
  transform: translateY(-30px);
}
@media (prefers-reduced-motion: reduce) {
  .mss-shelf-card img,
  .mss-shelf-label,
  .mss-shelf-run {
    transition: none;
  }
}
</style>

<style>
/* Global: these are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mss-shelf-card {
  position: relative;
  width: auto;
  overflow: hidden;
  padding: 0;
  border-radius: 18px;
  aspect-ratio: 1;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .mss-shelf-card:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
</style>
