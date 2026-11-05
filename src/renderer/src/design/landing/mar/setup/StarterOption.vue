<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, Check, ChevronRight, Cloud } from 'lucide-vue-next'
import CvFrame from './CvFrame.vue'
import { IMAGE_STARTERS, imgUrl, totalGb } from './canvasData'
import { STARTERS, type Starter } from './setupFlow'

/**
 * The starter workflow step in the look of the Home's examples
 * (userStates/ExampleRow.vue): the picture is the card, the name sits on
 * it, the type and size on glass chips. Same starters and sizes as the
 * flow. 1-3 keep today's Image / Video / 3D / Audio tabs over a row, a
 * bento or a feature view. 4-6 drop the tab bar: 4 and 6 show the
 * recommended one of each type, as the Home mixes its examples (the type
 * on a chip, the rest behind "See all"), 5 turns the tabs into the Home's
 * quiet text filters on the title line.
 */
const { option } = defineProps<{ option: number }>()

const KINDS = { image: 'Image', video: 'Video', '3d': '3D', audio: 'Audio' } as const
type Kind = keyof typeof KINDS
const MIXED = (Object.keys(KINDS) as Kind[]).map((k) => ({
  ...(STARTERS[k].find((s) => s.tag === 'Recommended') as Starter),
  kind: KINDS[k]
}))
const ALL = Object.values(STARTERS).flat().length
const mixed = option === 4 || option === 6
const cards = computed<(Starter & { kind?: string })[]>(() => (mixed ? MIXED : IMAGE_STARTERS))
const picked = ref<Starter | null>(mixed ? null : (IMAGE_STARTERS[1] as Starter))
const size = (s: Starter): string => (s.credits ? 'No download' : `${s.gb} GB`)
const total = computed(() => totalGb(picked.value?.gb ?? 0))
const layout = { 1: 1, 2: 2, 3: 3, 4: 1, 5: 1, 6: 2 }[option] ?? 1
</script>

<template>
  <CvFrame :step="3" layout="wide">
    <div class="sx-head">
      <span class="grid">
        <h1 class="fo-title">Choose a starter workflow</h1>
        <p class="fo-lead">Opens a ready-to-run workflow. Models download during setup.</p>
      </span>
      <!-- 5 · The tabs as the Home's text filters, on the title line. -->
      <span v-if="option === 5" class="sx-filters">
        <span v-for="(label, k) in KINDS" :key="k" :class="k === 'image' && 'is-on'">{{
          label
        }}</span>
      </span>
    </div>
    <div v-if="option <= 3" class="cv-seg is-fit" style="margin-top: 20px; width: 360px">
      <span class="is-on">Image</span><span>Video</span><span>3D</span><span>Audio</span>
    </div>

    <div class="sx" :class="`is-${layout}`">
      <div
        v-for="s in cards"
        :key="s.id"
        class="sx-card"
        role="radio"
        :aria-checked="picked?.id === s.id"
        @click="picked = picked?.id === s.id && mixed ? null : s"
      >
        <img :src="imgUrl(s.img)" alt="" />
        <span class="sx-chips">
          <span v-if="s.kind" class="sx-chip">{{ s.kind }}</span>
          <span class="sx-chip">{{ size(s) }}</span>
          <span v-if="s.credits" class="sx-chip"><Cloud :size="11" />Runs on Cloud</span>
          <span v-else-if="s.tag && !s.kind" class="sx-chip">{{ s.tag }}</span>
        </span>
        <span class="sx-pick" aria-hidden="true"><Check :size="12" :stroke-width="3" /></span>
        <span class="sx-name">{{ s.title }}</span>
      </div>

      <!-- 3 · Feature: the pick, large, with what it brings. -->
      <div v-if="option === 3 && picked" class="sx-feature">
        <img :src="imgUrl(picked.img)" alt="" />
        <span class="sx-feature-text">
          <span class="sx-chip">{{ picked.tag ?? 'Image' }}</span>
          <span class="sx-feature-name">{{ picked.title }}</span>
          <span class="sx-feature-meta"
            >{{ size(picked) }} of models · opens when the install is done</span
          >
        </span>
      </div>
    </div>
    <span v-if="mixed" class="sx-all">See all {{ ALL }} workflows<ChevronRight :size="13" /></span>

    <template #bar>
      <span class="cv-btn is-ghost"><ArrowLeft :size="14" />Back</span>
      <span class="cv-grow"></span>
      <span v-if="picked" class="cv-btn">Skip workflow</span
      ><span class="cv-btn is-primary"
        >Install<span class="cv-n">· {{ total }}</span></span
      >
    </template>
  </CvFrame>
</template>

<style>
.sx {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}
/* The Home's example card: picture full bleed, name on a dark foot. */
.sx-card {
  position: relative;
  overflow: hidden;
  border-radius: 16px;
  cursor: pointer;
  isolation: isolate;
}
.sx-card img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 600ms cubic-bezier(0.16, 1, 0.3, 1);
}
.sx-card:hover img {
  transform: scale(1.04);
}
.sx-card::after {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  background: linear-gradient(to top, rgb(0 0 0 / 0.72), transparent 55%);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);
  content: '';
  transition: box-shadow 160ms ease;
}
.sx-card[aria-checked='true']::after {
  box-shadow: inset 0 0 0 2px #fff;
}
.sx-card:not([aria-checked='true']) img {
  filter: saturate(0.85) brightness(0.85);
}
.sx-chips {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sx-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--color-media-overlay, rgb(0 0 0 / 0.45));
  backdrop-filter: blur(12px);
  color: rgb(255 255 255 / 0.92);
  font-size: 11px;
  line-height: 14px;
  white-space: nowrap;
}
.sx-pick {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.3);
  box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.7);
  backdrop-filter: blur(12px);
  color: transparent;
  transition:
    background-color 160ms ease,
    color 160ms ease;
}
.sx-card[aria-checked='true'] .sx-pick {
  background: #fff;
  color: #111;
}
.sx-name {
  position: absolute;
  right: 14px;
  bottom: 12px;
  left: 14px;
  z-index: 1;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
  text-wrap: balance;
}

/* 1 · Row: four tall pictures, as the Home's row. */
.sx.is-1 {
  grid-template-columns: repeat(4, 1fr);
}
.sx.is-1 .sx-card {
  aspect-ratio: 3 / 4;
}

/* 2 · Bento: the recommended one big, the rest beside it. */
.sx.is-2 {
  grid-template-columns: 1.4fr 1fr 1fr;
  grid-template-rows: 172px 172px;
}
.sx.is-2 .sx-card:first-child {
  grid-row: span 2;
}
.sx.is-2 .sx-card:first-child .sx-name {
  font-size: 18px;
}
.sx.is-2 .sx-card:nth-child(4) {
  grid-column: span 2;
}

/* 3 · Feature: thumbnails on the left, the pick large on the right. */
.sx.is-3 {
  grid-template-columns: repeat(2, 200px) 1fr;
  grid-template-rows: repeat(2, 150px);
}
.sx-feature {
  position: relative;
  grid-row: 1 / 3;
  grid-column: 3;
  overflow: hidden;
  border-radius: 16px;
}
.sx-feature img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.sx-feature::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgb(0 0 0 / 0.75), transparent 60%);
  content: '';
}
.sx-feature-text {
  position: absolute;
  right: 20px;
  bottom: 18px;
  left: 20px;
  z-index: 1;
  display: grid;
  justify-items: start;
  gap: 6px;
  color: #fff;
}
.sx-feature-name {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.sx-feature-meta {
  color: rgb(255 255 255 / 0.7);
}
.sx.is-3 .sx-name {
  font-size: 12px;
}

/* Title line: the lead on the left, the filters (5) on the right. */
.sx-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}
.sx-filters {
  display: flex;
  gap: 18px;
  padding-bottom: 2px;
  color: var(--color-subtle-foreground);
}
.sx-filters .is-on {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-thickness: 1.5px;
  text-underline-offset: 8px;
}
.sx-head + .sx {
  margin-top: 24px;
}
.sx-all {
  display: inline-flex;
  align-self: flex-end;
  align-items: center;
  gap: 2px;
  margin-top: 12px;
  color: var(--color-muted-foreground);
}
</style>
