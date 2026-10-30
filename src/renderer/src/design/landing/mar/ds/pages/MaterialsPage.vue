<script setup lang="ts">
import { onMounted, ref } from 'vue'
import portraitGarden from '../../assets/portrait-garden.jpg'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import { LEVELS } from '../materials'
import { useMode } from '../kit/mode'
import MaterialsGlass from './MaterialsGlass.vue'

/**
 * Materials · Blur, in this frame's theme: what each material computes to
 * (read from the specimens below, so it can't drift from the CSS), then
 * each one over a busy picture and over the plain page.
 */
interface Reading {
  blur: string
  background: string
  ring: string
  radius: string
  /** Text against the surface with pure white, then pure black, behind
   *  (none for a surface without text, like the scrim). */
  contrast?: [number, number]
}
const readings = ref<Record<string, Reading>>({})
const root = ref<HTMLElement>()
// Overview: every level at a glance, over a picture. Details: the table
// and each level over a picture and the plain page.
const overview = useMode().mode === 'overview'

// Composites a colour over white or black on a canvas (it parses oklch
// and color-mix results), then reads it back as sRGB.
const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
function over(base: string, ...layers: string[]): [number, number, number] {
  ctx.clearRect(0, 0, 1, 1)
  for (const c of [base, ...layers]) {
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
  }
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return [r!, g!, b!]
}
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number): number => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(text: string, surface: string, behind: string): number {
  const bg = over(behind, surface)
  const fg = over(behind, surface, text)
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number]
  return Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10
}

function read(el: HTMLElement): Reading {
  const s = getComputedStyle(el)
  // The colour of the first words in it.
  const words = document
    .createTreeWalker(el, NodeFilter.SHOW_TEXT, (n) =>
      n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    )
    .nextNode()
  const color = words?.parentElement ? getComputedStyle(words.parentElement).color : undefined
  return {
    blur: s.backdropFilter === 'none' ? '—' : s.backdropFilter,
    background: s.backgroundColor,
    ring: s.boxShadow === 'none' ? '—' : s.boxShadow,
    radius: s.borderRadius,
    contrast: color
      ? [contrast(color, s.backgroundColor, '#fff'), contrast(color, s.backgroundColor, '#000')]
      : undefined
  }
}

onMounted(() => {
  // Once the app's stylesheets have settled.
  setTimeout(() => {
    const out: Record<string, Reading> = {}
    for (const l of LEVELS) {
      const el = root.value?.querySelector<HTMLElement>(`[data-glass="${l.id}"]`)
      if (el) out[l.id] = read(el)
    }
    readings.value = out
  }, 600)
})

const split = (shadow: string): string[] => shadow.split(/,(?![^(]*\))/).map((x) => x.trim())
const low = (n: number): boolean => n < 4.5
</script>

<template>
  <div ref="root" class="ds-mat">
    <Section
      v-if="overview"
      title="Every level"
      note="Blur on what floats over content. Cards on the page blur too today; with UI Playground › Crit feedback On they are solid."
    >
      <Cells :min="200">
        <Cell v-for="l in LEVELS" :key="l.id" :label="l.name" fill>
          <div class="ds-photo ds-mat-photo" :style="{ backgroundImage: `url(${portraitGarden})` }">
            <MaterialsGlass :id="l.id" />
          </div>
        </Cell>
      </Cells>
    </Section>
    <Section
      v-if="!overview"
      title="Levels in use"
      note="Computed in this theme. Contrast: the text on its surface with pure white, then pure black, behind."
    >
      <div class="ds-mat-table" role="table">
        <div class="ds-mat-tr is-head" role="row">
          <span role="columnheader">Level</span>
          <span role="columnheader">backdrop-filter</span>
          <span role="columnheader">background</span>
          <span role="columnheader">ring · shadow</span>
          <span role="columnheader">radius</span>
          <span role="columnheader">contrast<br />○ white · ● black</span>
        </div>
        <div v-for="l in LEVELS" :key="l.id" class="ds-mat-tr" role="row">
          <span role="cell" class="ds-mat-name"
            >{{ l.name }}<em v-if="l.note">{{ l.note }}</em></span
          >
          <template v-if="readings[l.id]">
            <code role="cell">{{ readings[l.id]!.blur }}</code>
            <code role="cell" class="ds-mat-bg">
              <i :style="{ background: readings[l.id]!.background }" />{{
                readings[l.id]!.background
              }}
            </code>
            <code role="cell">
              <span v-for="(x, i) in split(readings[l.id]!.ring)" :key="i">{{ x }}</span>
            </code>
            <code role="cell">{{ readings[l.id]!.radius }}</code>
            <code v-if="readings[l.id]!.contrast" role="cell">
              <span>
                <b v-for="(c, i) in readings[l.id]!.contrast" :key="i" :class="low(c) && 'is-low'"
                  >{{ i ? ' · ' : '' }}{{ c }}</b
                >
              </span>
            </code>
            <code v-else role="cell">—</code>
          </template>
        </div>
      </div>
    </Section>

    <Section v-for="l in overview ? [] : LEVELS" :key="l.id" :title="l.name" :note="l.usedBy">
      <Cells :min="240">
        <Cell label="over a busy picture" fill>
          <div class="ds-photo ds-mat-photo" :style="{ backgroundImage: `url(${portraitGarden})` }">
            <MaterialsGlass :id="l.id" />
          </div>
        </Cell>
        <Cell label="over the page" fill>
          <div class="ds-mat-plain"><MaterialsGlass :id="l.id" /></div>
        </Cell>
      </Cells>
    </Section>
  </div>
</template>

<style>
.ds-mat {
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.ds-mat-table {
  display: grid;
  grid-template-columns:
    minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1.6fr)
    minmax(0, 0.45fr) minmax(0, 0.6fr);
  overflow: hidden;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  font-size: 11.5px;
}
.ds-mat-tr {
  display: contents;
}
.ds-mat-tr > * {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 8px 7px;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  overflow-wrap: anywhere;
}
.ds-mat-tr.is-head > * {
  border-top: 0;
  color: var(--color-muted-foreground);
  font-weight: 500;
}
.ds-mat-tr code {
  color: var(--color-base-foreground);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 10px;
  line-height: 1.45;
}
.ds-mat-name {
  color: var(--color-base-foreground);
  font-weight: 500;
}
.ds-mat-name em {
  color: var(--color-muted-foreground);
  font-style: normal;
  font-weight: 400;
}
.ds-mat-bg {
  flex-direction: row !important;
  align-items: flex-start;
}
.ds-mat-bg i {
  width: 12px;
  height: 12px;
  flex: none;
  margin: 1px 6px 0 0;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 15%, transparent);
}
.ds-mat-tr b {
  font-weight: 500;
}
.ds-mat-tr b.is-low {
  color: var(--color-status-danger);
}
.ds-mat-photo,
.ds-mat-plain {
  position: relative;
  min-height: 150px;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.ds-mat-plain {
  display: flex;
}
</style>
