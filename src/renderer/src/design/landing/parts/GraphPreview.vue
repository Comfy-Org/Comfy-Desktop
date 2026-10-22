<script setup lang="ts">
import { computed } from 'vue'
import { thumb } from '../mock'

/**
 * Static, ComfyUI-flavoured node graph used as a preview. Not interactive -
 * just enough to show "this is a graph that opens in ComfyUI".
 */
const props = withDefaults(
  defineProps<{ thumbId: string; category?: string; zoom?: number; model?: string }>(),
  { category: 'image', zoom: 1, model: 'z_image_turbo_bf16.safetensors' }
)

interface GNode {
  id: string
  title: string
  x: number
  y: number
  w: number
  ins: string[]
  outs: string[]
  widgets: [string, string][]
  text?: string
  image?: boolean
}

const HEADER = 24
const ROW = 18

const nodes = computed<GNode[]>(() => [
  {
    id: 'load',
    title: props.category === 'video' ? 'Load Video Model' : 'Load Diffusion Model',
    x: 20,
    y: 24,
    w: 210,
    ins: [],
    outs: ['MODEL'],
    widgets: [
      ['unet_name', props.model],
      ['weight_dtype', 'default']
    ]
  },
  {
    id: 'clip',
    title: 'CLIP Text Encode (Prompt)',
    x: 20,
    y: 150,
    w: 210,
    ins: ['clip'],
    outs: ['CONDITIONING'],
    widgets: [],
    text: 'Editorial portrait, warm natural light, freckles, shallow depth of field, film grain'
  },
  {
    id: 'sampler',
    title: 'KSampler',
    x: 280,
    y: 52,
    w: 190,
    ins: ['model', 'positive', 'negative', 'latent_image'],
    outs: ['LATENT'],
    widgets: [
      ['seed', '539436441'],
      ['steps', '8'],
      ['cfg', '1.0'],
      ['sampler_name', 'res_multistep']
    ]
  },
  {
    id: 'decode',
    title: 'VAE Decode',
    x: 510,
    y: 96,
    w: 140,
    ins: ['samples', 'vae'],
    outs: ['IMAGE'],
    widgets: []
  },
  {
    id: 'save',
    title: props.category === 'video' ? 'Save Video' : 'Save Image',
    x: 690,
    y: 20,
    w: 180,
    ins: ['images'],
    outs: [],
    widgets: [],
    image: true
  }
])

const byId = computed(() => Object.fromEntries(nodes.value.map((n) => [n.id, n])))
const portY = (n: GNode, i: number): number => n.y + HEADER + ROW / 2 + 4 + i * ROW

const links: [string, number, string, number][] = [
  ['load', 0, 'sampler', 0],
  ['clip', 0, 'sampler', 1],
  ['sampler', 0, 'decode', 0],
  ['decode', 0, 'save', 0]
]
const wires = computed(() =>
  links.map(([a, ao, b, bi]) => {
    const from = byId.value[a]!
    const to = byId.value[b]!
    const x1 = from.x + from.w
    const y1 = portY(from, ao)
    const x2 = to.x
    const y2 = portY(to, bi)
    const dx = Math.max(40, (x2 - x1) / 2)
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
  })
)
</script>

<template>
  <div class="gp">
    <div class="gp-stage" :style="{ transform: `translate(-50%, -44%) scale(${zoom})` }">
      <svg class="gp-wires" width="890" height="330" aria-hidden="true">
        <path v-for="(d, i) in wires" :key="i" :d="d" />
      </svg>
      <div
        v-for="n in nodes"
        :key="n.id"
        class="gp-node"
        :style="{ left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px` }"
      >
        <div class="gp-title">{{ n.title }}</div>
        <div v-for="r in Math.max(n.ins.length, n.outs.length)" :key="r" class="gp-slot">
          <span v-if="n.ins[r - 1]" class="gp-in"><i />{{ n.ins[r - 1] }}</span>
          <span v-if="n.outs[r - 1]" class="gp-out">{{ n.outs[r - 1] }}<i /></span>
        </div>
        <div v-for="[k, v] in n.widgets" :key="k" class="gp-widget">
          <span>{{ k }}</span
          ><span>{{ v }}</span>
        </div>
        <div v-if="n.text" class="gp-text">{{ n.text }}</div>
        <img v-if="n.image && thumbId" class="gp-img" :src="thumb(thumbId)" alt="" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.gp {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #141415;
  background-image: radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px);
  background-size: 18px 18px;
}
.gp-stage {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 890px;
  height: 330px;
  transform-origin: center;
  transition: transform 200ms ease;
}
.gp-wires {
  position: absolute;
  inset: 0;
  overflow: visible;
}
.gp-wires path {
  fill: none;
  stroke: rgba(255, 255, 255, 0.32);
  stroke-width: 2;
}
.gp-node {
  position: absolute;
  padding-bottom: 6px;
  border-radius: 8px;
  background: #262628;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 6px 16px rgba(0, 0, 0, 0.4);
  font-size: 10.5px;
  color: #c9c9c9;
}
.gp-title {
  height: 24px;
  padding: 0 10px;
  line-height: 24px;
  border-radius: 8px 8px 0 0;
  background: #303033;
  font-weight: 500;
  color: #e6e6e6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gp-slot {
  position: relative;
  display: flex;
  justify-content: space-between;
  height: 18px;
  margin-top: 4px;
  padding: 0 10px;
  line-height: 18px;
  color: #9a9a9a;
}
.gp-slot + .gp-slot {
  margin-top: 0;
}
.gp-in,
.gp-out {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.gp-out {
  margin-left: auto;
}
.gp-slot i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #8a8a8a;
}
.gp-in i {
  margin-left: -13px;
}
.gp-out i {
  margin-right: -13px;
}
/* Node 8, inset 6 -> widgets 2 (min 4 reads better at this size). */
.gp-widget {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  height: 18px;
  margin: 3px 6px 0;
  padding: 0 8px;
  border-radius: 4px;
  background: #1c1c1e;
  line-height: 18px;
}
.gp-widget span:last-child {
  color: #e6e6e6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gp-text {
  height: 64px;
  margin: 4px 6px 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: #1c1c1e;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 9.5px;
  line-height: 1.4;
  color: #bdbdbd;
}
.gp-img {
  display: block;
  width: calc(100% - 12px);
  aspect-ratio: 1;
  margin: 6px 6px 0;
  border-radius: 4px;
  object-fit: cover;
}
</style>
