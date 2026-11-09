<script setup lang="ts">
import { computed, type Component } from 'vue'
import { AudioLines, Binary, Box, Braces, FileText, Sheet } from 'lucide-vue-next'
import { GRAIN } from '../brand/imagery'
import type { MarAsset } from '../pages/assetsStore'

/**
 * An asset's cover when it has no picture (text, data, audio, 3D, other
 * files): the kind's own hue washed over the card, a faint hint of what is
 * inside (lines of a note, keys of a JSON, a sheet's cells, a waveform),
 * and the extension as the label, so the type reads at a glance. Hue and
 * strength are fixed per kind and mixed into the theme's tokens, like the
 * Workflow gradient's fixed light, so a wall of files sits at one level and
 * works in light and dark. The name only varies the hint's lines a little.
 * Small tiles (a list row) keep the wash and the kind's icon.
 */
const { name, type } = defineProps<{ name: string; type: MarAsset['type'] }>()

type Kind = 'doc' | 'code' | 'table' | 'audio' | '3d' | 'file'

const BY_EXT: Record<string, Kind> = {
  md: 'doc',
  txt: 'doc',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  csv: 'table',
  tsv: 'table'
}
const KINDS: Record<Kind, { icon: Component }> = {
  doc: { icon: FileText },
  code: { icon: Braces },
  table: { icon: Sheet },
  audio: { icon: AudioLines },
  '3d': { icon: Box },
  file: { icon: Binary }
}

const ext = computed(() => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''))
const kind = computed<Kind>(
  () =>
    BY_EXT[ext.value] ??
    ({ text: 'doc', audio: 'audio', '3d': '3d' } as Record<string, Kind>)[type] ??
    'file'
)
const tint = computed(() => {
  return { '--ac-grain': GRAIN }
})

/** A repeatable number from 0 to 1 per name and use. */
const hash = computed(() => [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7))
const pick = (n: number): number => (((hash.value + n * 2654435761) >>> 0) % 1000) / 1000

/** Drawn on a 100×64 stage. */
const DOC = computed(() =>
  [0, 1, 2, 3, 4].map((i) => ({ y: 18 + i * 10, w: i === 4 ? 40 : 70 + pick(i) * 30 }))
)
const CODE = computed(() =>
  [10, 20, 20, 20, 10].map((x, i) => ({ y: 10 + i * 10, x, k: 14 + pick(i) * 10 }))
)
const WAVE = computed(() =>
  Array.from({ length: 25 }, (_, i) => {
    const env = Math.sin(((i + 0.5) / 25) * Math.PI)
    return { x: i * 4 + 0.75, h: 6 + env * (14 + pick(i) * 30) }
  })
)
</script>

<template>
  <span class="ac" :class="`is-${kind}`" :style="tint" aria-hidden="true">
    <span class="ac-art">
      <svg v-if="kind === 'doc'" class="ac-hint" viewBox="0 0 100 64">
        <rect x="0" y="2" width="48" height="7" rx="2" class="is-strong" />
        <rect v-for="l in DOC" :key="l.y" x="0" :y="l.y" :width="l.w" height="4" rx="2" />
      </svg>
      <svg v-else-if="kind === 'code'" class="ac-hint" viewBox="0 0 100 64">
        <rect x="0" y="0" width="6" height="4" rx="2" class="is-strong" />
        <template v-for="l in CODE" :key="l.y">
          <rect :x="l.x" :y="l.y" :width="l.k" height="4" rx="2" class="is-strong" />
          <rect :x="l.x + l.k + 4" :y="l.y" :width="60 - l.x - l.k / 2" height="4" rx="2" />
        </template>
        <rect x="0" y="60" width="6" height="4" rx="2" class="is-strong" />
      </svg>
      <svg v-else-if="kind === 'table'" class="ac-hint" viewBox="0 0 100 64">
        <template v-for="r in 5" :key="r">
          <rect
            v-for="c in 4"
            :key="c"
            :x="(c - 1) * 25.5"
            :y="(r - 1) * 13"
            width="23.5"
            height="11"
            rx="2"
            :class="r === 1 && 'is-strong'"
          />
        </template>
      </svg>
      <svg v-else-if="kind === 'audio'" class="ac-hint" viewBox="0 0 100 64">
        <rect
          v-for="b in WAVE"
          :key="b.x"
          :x="b.x"
          :y="32 - b.h / 2"
          width="2.5"
          :height="b.h"
          rx="1.25"
          class="is-strong"
        />
      </svg>
      <component :is="KINDS[kind].icon" v-else class="ac-glyph" :stroke-width="1.25" />
      <span v-if="ext" class="ac-ext">.{{ ext }}</span>
    </span>
    <component :is="KINDS[kind].icon" class="ac-icon" :size="16" />
  </span>
</template>

<style scoped>
.ac {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  /* A white wash over the card, like Home's covers: the type reads from
     the hint and the extension, not from colour. */
  background: linear-gradient(
    160deg,
    color-mix(in oklab, var(--color-base-foreground) 9%, transparent),
    color-mix(in oklab, var(--color-base-foreground) 2%, transparent)
  );
  color: var(--color-muted-foreground);
  container-type: size;
}
/* The shared grain, as on the Workflow gradient. */
.ac::after {
  position: absolute;
  inset: 0;
  background-image: var(--ac-grain);
  content: '';
  mix-blend-mode: overlay;
  opacity: 0.08;
  pointer-events: none;
}
.ac-art {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(6px, 5cqmin, 18px);
}
.ac-hint {
  width: clamp(40px, 46cqmin, 200px);
  height: auto;
  overflow: visible;
}
.ac-hint rect {
  fill: currentColor;
  opacity: 0.28;
}
.ac-hint rect.is-strong {
  opacity: 0.55;
}
.ac-glyph {
  width: clamp(28px, 30cqmin, 120px);
  height: auto;
  opacity: 0.7;
}
.ac-ext {
  font-size: clamp(11px, 6cqw, 26px);
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1;
}
.ac-icon {
  display: none;
}
/* A list row's thumbnail: the wash and the icon, nothing to read. */
@container (max-height: 56px) {
  .ac-art {
    display: none;
  }
  .ac-icon {
    display: block;
  }
}
</style>
