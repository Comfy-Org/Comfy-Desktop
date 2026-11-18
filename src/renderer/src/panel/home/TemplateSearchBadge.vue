<script setup lang="ts">
import { computed } from 'vue'
import { CircleDollarSign, Download, Gauge, HardDrive, Paperclip, Star } from '@lucide/vue'
import type { BadgeTone } from './templateSearch'

const props = defineProps<{ tone: BadgeTone }>()

const TONES: Record<BadgeTone, string> = {
  partner: 'bg-[rgb(240_120_40/0.24)] text-[rgb(255_204_120)] ring-[rgb(245_140_60/0.55)]',
  strong: 'bg-[rgb(40_160_100/0.22)] text-[rgb(160_240_196)] ring-[rgb(80_200_140/0.45)]',
  good: 'bg-[rgb(60_130_200/0.22)] text-[rgb(176_214_255)] ring-[rgb(100_160_230/0.45)]',
  weak: 'bg-[rgb(137_137_137/0.2)] text-[rgb(205_205_210)] ring-[rgb(160_160_170/0.4)]',
  best: 'bg-[rgb(255_255_255/0.14)] text-[rgb(245_245_245)] ring-[rgb(255_255_255/0.3)]',
  download: 'bg-[rgb(60_170_190/0.18)] text-[rgb(170_230_240)] ring-[rgb(90_190_210/0.45)]',
  size: 'bg-[rgb(60_170_190/0.18)] text-[rgb(170_230_240)] ring-[rgb(90_190_210/0.45)]',
  input: 'bg-[rgb(170_120_220/0.18)] text-[rgb(222_204_250)] ring-[rgb(180_140_230/0.45)]'
}

const ICONS: Partial<Record<BadgeTone, typeof Gauge>> = {
  partner: CircleDollarSign,
  best: Star,
  download: Download,
  size: HardDrive,
  input: Paperclip
}

const icon = computed(() => ICONS[props.tone] ?? Gauge)
</script>

<template>
  <span
    class="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md px-2 text-[12px] leading-none font-medium whitespace-nowrap ring-1 ring-inset"
    :class="TONES[tone]"
  >
    <component :is="icon" :size="12" :stroke-width="2.25" aria-hidden="true" />
    <slot />
  </span>
</template>
