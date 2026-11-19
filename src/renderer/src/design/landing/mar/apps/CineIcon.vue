<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, useId } from 'vue'

import type { DirectionPart, IconShape, IconTone } from './cameraIcons'
import { cameraIcon } from './cameraIcons'

const { part, option } = defineProps<{
  part: DirectionPart
  option: string
}>()

const icon = computed(() => cameraIcon(part, option))
const id = useId()
const paint = (name: string) => `url(#${id}-${name})`

const clay = (whiteShare: number) => `color-mix(in srgb, #f0efed ${whiteShare}%, #211927)`
const white = (alpha: number) => `rgb(from #f0efed r g b / ${alpha})`
const yellow = (alpha: number) => `rgb(from #f2ff59 r g b / ${alpha})`
const black = (alpha: number) => `rgb(0 0 0 / ${alpha})`

const GRADIENTS = [
  { name: 'front', x2: 0, y2: 1, stops: [clay(43), clay(19)] },
  { name: 'top', x2: 0, y2: 1, stops: [clay(81), clay(59)] },
  { name: 'side', x2: 1, y2: 0, stops: [clay(15), clay(5)] },
  { name: 'ring', x2: 0, y2: 1, stops: [clay(58), clay(36), clay(15)] },
  {
    name: 'brass',
    x2: 0,
    y2: 1,
    stops: ['color-mix(in srgb, #fabc25 45%, #c2bfb9)', 'color-mix(in srgb, #fabc25 30%, #211927)']
  },
  {
    name: 'screen',
    x2: 1,
    y2: 1,
    stops: ['#49378b', 'color-mix(in srgb, #49378b 30%, #211927)']
  }
] as const

const GLASS_STOPS = [
  { offset: 0, color: '#49378b' },
  {
    offset: 0.35,
    color: 'color-mix(in srgb, #49378b 30%, #211927)'
  },
  {
    offset: 0.8,
    color: 'color-mix(in srgb, #211927 45%, black)'
  },
  { offset: 1, color: '#211927' }
] as const

const face = (name: string): CSSProperties => ({
  fill: paint(name),
  stroke: paint(name),
  strokeWidth: 2.6,
  strokeLinejoin: 'round'
})
const line = (stroke: string, strokeWidth: number): CSSProperties => ({
  fill: 'none',
  stroke,
  strokeWidth,
  strokeLinecap: 'round'
})

const TONES: Readonly<Record<IconTone, CSSProperties>> = {
  shadow: { fill: black(0.55), filter: paint('soft') },
  front: face('front'),
  top: face('top'),
  side: face('side'),
  ring: face('ring'),
  brass: face('brass'),
  lensRing: { fill: paint('ring'), stroke: paint('ring'), strokeWidth: 1.4 },
  glass: { fill: paint('glass') },
  screen: { fill: paint('screen') },
  highlight: line(white(0.45), 0.6),
  highlightSoft: line(white(0.35), 0.6),
  highlightFaint: line(white(0.25), 0.5),
  knurl: line(black(0.3), 0.45),
  vent: line(black(0.55), 0.7),
  tick: line('#f0efed', 0.7),
  coating: line('rgb(from #49378b r g b / 0.9)', 0.5),
  coatingGlow: line(yellow(0.4), 0.6),
  spark: line(yellow(0.85), 1),
  glint: { fill: white(0.85) },
  record: { fill: '#ff3b3b' },
  flare: line(yellow(0.8), 1.1),
  flareGlow: { fill: yellow(0.25) },
  fov: { fill: yellow(0.12) },
  fovEdge: line(yellow(0.6), 0.8),
  fovAuto: {
    ...line('#7e7c78', 0.8),
    strokeDasharray: '2 2'
  }
}

function shapeStyle(shape: IconShape): CSSProperties {
  const style = TONES[shape.tone]
  return shape.flat ? { ...style, stroke: 'none' } : style
}
</script>

<template>
  <svg v-if="icon" viewBox="0 0 64 40" aria-hidden="true">
    <defs>
      <linearGradient
        v-for="gradient in GRADIENTS"
        :id="`${id}-${gradient.name}`"
        :key="gradient.name"
        x1="0"
        y1="0"
        :x2="gradient.x2"
        :y2="gradient.y2"
      >
        <stop
          v-for="(color, index) in gradient.stops"
          :key="index"
          :offset="index / (gradient.stops.length - 1)"
          :style="{ stopColor: color }"
        />
      </linearGradient>
      <radialGradient :id="`${id}-glass`" cx="0.4" cy="0.35" r="0.85">
        <stop
          v-for="stop in GLASS_STOPS"
          :key="stop.offset"
          :offset="stop.offset"
          :style="{ stopColor: stop.color }"
        />
      </radialGradient>
      <filter :id="`${id}-soft`" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.4" />
      </filter>
    </defs>
    <path
      v-for="(shape, index) in icon"
      :key="index"
      :d="shape.d"
      :transform="shape.transform"
      :style="shapeStyle(shape)"
    />
  </svg>
</template>
