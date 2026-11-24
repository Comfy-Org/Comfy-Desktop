<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref, type CSSProperties } from 'vue'

const { name = '' } = defineProps<{ name?: string }>()

const STAGE_WIDTH = 280
const STAGE_HEIGHT = 175
const LEANS = [-12, -9, -14, -10]
const OUTPUTS = [64, 70, 60, 66]

const CANVAS = '#151517'
const NODE = '#222225'
const HEAD = '#2a2a2e'
const EDGE = 'rgb(255 255 255 / 0.085)'
const PILL = 'rgb(255 255 255 / 0.32)'
const PILL_SOFT = 'rgb(255 255 255 / 0.13)'
const FIELD = '#19191c'
const PREVIEW = '#18181b'
const WIRE = '#8a8a92'
const LIFT = '0 2px 0 rgb(0 0 0 / 0.5), 0 18px 22px -12px rgb(0 0 0 / 0.85)'
const OUT = '#a8a8b0'
const OUT_HEAD = '#45454a'

const seed = computed(() => [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % LEANS.length)
const lean = computed(() => LEANS[seed.value]!)
const preview = computed(() => OUTPUTS[seed.value]!)
const outputHeight = computed(() => Math.ceil((50 + preview.value) / 10) * 10)

const root = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(root)
const scale = computed(() => Math.max(width.value / STAGE_WIDTH, height.value / STAGE_HEIGHT, 0.01))

const WIRES = [
  'M28 50 C49 50 49 88 70 88',
  'M28 74 C49 74 49 100 70 100',
  'M28 98 C49 98 49 112 70 112',
  'M190 88 C210 88 194 72 214 72'
]
const INPUTS = [40, 64, 88]
const ROWS = [
  { y: 32, w: 22 },
  { y: 44, w: 30 },
  { y: 56, w: 18 }
]
const FIELDS = [
  { y: 62, l: 26, v: 14 },
  { y: 76, l: 34, v: 10 }
]

function node(extra: CSSProperties): CSSProperties {
  return {
    position: 'absolute',
    boxSizing: 'border-box',
    width: '120px',
    borderRadius: '6px',
    background: NODE,
    boxShadow: `${LIFT}, inset 0 0 0 1px ${EDGE}`,
    ...extra
  }
}

function head(whole: boolean, background = HEAD): CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    height: '20px',
    borderRadius: whole ? '6px' : '6px 6px 0 0',
    background,
    boxShadow: whole ? 'none' : `inset 0 -1px 0 ${EDGE}`
  }
}

function mark(background = PILL): CSSProperties {
  return {
    position: 'absolute',
    top: '7px',
    left: '8px',
    width: '6px',
    height: '6px',
    borderRadius: '99px',
    background
  }
}

function title(w: number): CSSProperties {
  return {
    position: 'absolute',
    top: '8px',
    left: '20px',
    width: `${w}px`,
    height: '4.5px',
    borderRadius: '99px',
    background: PILL
  }
}

function socket(left: number, top: number): CSSProperties {
  return {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: '7px',
    height: '7px',
    borderRadius: '99px',
    background: WIRE,
    boxShadow: `0 0 0 2px ${NODE}`
  }
}

function bar(place: CSSProperties, background = PILL_SOFT): CSSProperties {
  return { position: 'absolute', height: '3.5px', borderRadius: '99px', background, ...place }
}

const stageStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: `${STAGE_WIDTH}px`,
  height: `${STAGE_HEIGHT}px`,
  margin: `-${STAGE_HEIGHT / 2}px 0 0 -${STAGE_WIDTH / 2}px`,
  transform: `scale(${scale.value})`
}))

const planeStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  inset: 0,
  transformOrigin: '45% 58%',
  transform: `perspective(620px) rotateX(34deg) rotateZ(${lean.value}deg) scale(1.16)`
}))

const DOTS: CSSProperties = {
  position: 'absolute',
  inset: '-280px',
  backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.075) 0.9px, transparent 1.2px)',
  backgroundPosition: '10px 10px',
  backgroundSize: '20px 20px'
}
const GROUP: CSSProperties = {
  position: 'absolute',
  top: '16px',
  left: '52px',
  width: '310px',
  height: '190px',
  borderRadius: '6px',
  background: 'rgb(168 168 176 / 0.07)',
  boxShadow: 'inset 0 0 0 1px rgb(168 168 176 / 0.32)'
}
const INPUT_NODE = (top: number): CSSProperties =>
  node({ left: '-52px', width: '80px', height: '20px', top: `${top}px` })
const MAIN_NODE = node({ top: '56px', left: '70px', height: '100px' })
const outputNode = computed(() =>
  node({
    top: '40px',
    left: '214px',
    height: `${outputHeight.value}px`,
    boxShadow: `${LIFT}, 0 0 0 3px rgb(168 168 176 / 0.14), inset 0 0 0 1px rgb(168 168 176 / 0.6)`
  })
)
const FIELD_STYLE = (top: number): CSSProperties => ({
  position: 'absolute',
  right: '8px',
  left: '8px',
  top: `${top}px`,
  height: '11px',
  borderRadius: '3px',
  background: FIELD
})
const previewStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  top: '42px',
  right: '8px',
  left: '8px',
  height: `${preview.value}px`,
  borderRadius: '4px',
  background: PREVIEW,
  boxShadow: `inset 0 0 0 1px ${EDGE}`
}))
const FADE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: `linear-gradient(180deg, ${CANVAS} 0%, rgb(21 21 23 / 0.6) 22%, rgb(21 21 23 / 0) 48%)`
}
const VIGNETTE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'radial-gradient(ellipse 78% 92% at 50% 62%, transparent 42%, rgb(0 0 0 / 0.3) 100%)'
}
</script>

<template>
  <div
    ref="root"
    class="relative size-full overflow-hidden"
    :style="{ background: CANVAS }"
    aria-hidden="true"
    data-testid="workflow-cover"
  >
    <div :style="stageStyle">
      <div :style="planeStyle">
        <div :style="DOTS" />
        <div :style="GROUP" />
        <svg
          class="absolute top-0 left-0 overflow-visible"
          width="280"
          height="175"
          viewBox="0 0 280 175"
          fill="none"
          :stroke="WIRE"
          stroke-linecap="round"
          stroke-width="2"
        >
          <path v-for="d in WIRES" :key="d" :d="d" />
        </svg>

        <div v-for="y in INPUTS" :key="y" :style="INPUT_NODE(y)">
          <span :style="head(true)">
            <i :style="mark()" />
            <i :style="title(44)" />
          </span>
          <i :style="socket(76.5, 6.5)" />
        </div>

        <div :style="MAIN_NODE">
          <span :style="head(false)">
            <i :style="mark()" />
            <i :style="title(54)" />
          </span>
          <template v-for="r in ROWS" :key="r.y">
            <i :style="socket(-3.5, r.y - 3.5)" />
            <i :style="bar({ left: '8.5px', top: `${r.y - 2}px`, width: `${r.w}px` })" />
          </template>
          <i :style="socket(116.5, 28.5)" />
          <i :style="bar({ left: '81.5px', top: '30px', width: '30px' })" />
          <span v-for="f in FIELDS" :key="f.y" :style="FIELD_STYLE(f.y)">
            <i :style="bar({ left: '6px', top: '4px', width: `${f.l}px` })" />
            <i :style="bar({ right: '6px', top: '4px', width: `${f.v}px` }, PILL)" />
          </span>
        </div>

        <div :style="outputNode">
          <span :style="head(false, OUT_HEAD)">
            <i :style="mark(OUT)" />
            <i :style="title(48)" />
          </span>
          <i :style="socket(-3.5, 28.5)" />
          <i :style="bar({ left: '8.5px', top: '30px', width: '22px' })" />
          <span :style="previewStyle" />
        </div>
      </div>
      <div :style="FADE" />
      <div :style="VIGNETTE" />
    </div>
  </div>
</template>
