<script setup lang="ts">
import { computed } from 'vue'
import { Download, Gauge, Handshake, Sparkles, Star } from 'lucide-vue-next'
import type { BadgeTone } from './templateSearch'

const props = withDefaults(defineProps<{ tone: BadgeTone; overlay?: boolean }>(), {
  overlay: false
})

const TONES: Record<BadgeTone, string> = {
  partner: 'bg-[rgb(76_92_214/0.24)] text-[rgb(196_204_255)] ring-[rgb(126_140_255/0.45)]',
  download: 'bg-[rgb(214_150_40/0.22)] text-[rgb(255_214_150)] ring-[rgb(240_180_80/0.45)]',
  rewrite: 'bg-[rgb(176_96_220/0.2)] text-[rgb(232_200_255)] ring-[rgb(190_130_240/0.4)]',
  strong: 'bg-[rgb(40_160_100/0.22)] text-[rgb(160_240_196)] ring-[rgb(80_200_140/0.45)]',
  good: 'bg-[rgb(60_130_200/0.22)] text-[rgb(176_214_255)] ring-[rgb(100_160_230/0.45)]',
  weak: 'bg-[rgb(137_137_137/0.2)] text-[rgb(205_205_210)] ring-[rgb(160_160_170/0.4)]',
  best: 'bg-[rgb(255_255_255/0.14)] text-[rgb(245_245_245)] ring-[rgb(255_255_255/0.3)]'
}

const OVERLAY =
  'bg-[rgb(12_12_14/0.82)] text-[rgb(246_246_248)] ring-[rgb(255_255_255/0.16)] shadow-[0_2px_8px_rgb(0_0_0/0.45)] backdrop-blur-sm'

const OVERLAY_ICON: Record<BadgeTone, string> = {
  partner: 'text-[rgb(150_165_255)]',
  download: 'text-[rgb(255_196_100)]',
  rewrite: 'text-[rgb(214_160_255)]',
  strong: 'text-[rgb(110_225_160)]',
  good: 'text-[rgb(130_185_255)]',
  weak: 'text-[rgb(190_190_196)]',
  best: 'text-white'
}

const ICONS = { partner: Handshake, download: Download, rewrite: Sparkles, best: Star }

const icon = computed(() => (props.tone in ICONS ? ICONS[props.tone as keyof typeof ICONS] : Gauge))
</script>

<template>
  <span
    class="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md px-2 text-[12px] leading-none font-medium whitespace-nowrap ring-1 ring-inset"
    :class="overlay ? OVERLAY : TONES[tone]"
    :data-tone="tone"
  >
    <component
      :is="icon"
      :size="12"
      :stroke-width="2.25"
      :class="overlay ? OVERLAY_ICON[tone] : ''"
      aria-hidden="true"
    />
    <slot />
  </span>
</template>
