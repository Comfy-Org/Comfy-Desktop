<script setup lang="ts">
import { computed } from 'vue'
import { Upload } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { mock } from '../../assets/mock'
import { NODE_ICONS } from '../../graph/nodeIcons'
import type { NodeKind } from '../../graph/canvasData'
import type { Starter } from '../createStarters'
import { graphFor } from './lookKitB'

export interface GhostAgent {
  shown: number
  drop: string
  prompt: string
  out: string
}

const {
  starter = null,
  workflow = null,
  agent = null
} = defineProps<{
  starter?: Starter | null
  workflow?: { name: string; cover?: string } | null
  agent?: GhostAgent | null
}>()

const STAGE_W = 1000
const STAGE_H = 440
const COL_X = [30, 360, 680]
const NODE_W = [230, 230, 300]
const PROMPTS: Record<string, string> = {
  image: 'A ceramic vase on wet marble, morning light, 85mm',
  video: 'Slow push in, wings unfold, soft wind',
  audio: 'Warm lo-fi piano loop, vinyl crackle'
}

interface Placed {
  key: string
  kind: NodeKind
  title: string
  left: number
  top: number
  w: number
  h: number
  col: number
}

const heightOf = (kind: NodeKind, col: number): number =>
  col === 2 ? 250 : kind === 'image' ? 150 : kind === 'prompt' ? 104 : 120

const source = computed<Starter | null>(
  () =>
    starter ??
    (workflow
      ? ({
          id: workflow.name,
          makes: workflow.name,
          model: 'Your workflow',
          media: 'image'
        } as Starter)
      : null)
)

const graph = computed(() => {
  const s = source.value
  if (!s) return { nodes: [] as Placed[], wires: [] as string[] }
  const g = graphFor(s)
  const nodes: Placed[] = g.nodes.map((n, i) => {
    const col = n.x < 300 ? 0 : n.x < 600 ? 1 : 2
    const h = heightOf(n.kind, col)
    return {
      key: `${s.id}-${i}-${n.kind}`,
      kind: n.kind,
      title: n.title,
      left: COL_X[col]!,
      top: n.y + 20 - h / 2,
      w: NODE_W[col]!,
      h,
      col
    }
  })
  const shown = agent ? agent.shown : nodes.length
  const wires = g.wires
    .filter(([a, b]) => a < shown && b < shown)
    .map(([a, b]) => {
      const p = nodes[a]!
      const t = nodes[b]!
      const x1 = p.left + p.w
      const y1 = p.top + p.h / 2
      const x2 = t.left
      const y2 = t.top + t.h / 2
      const mid = (x1 + x2) / 2
      return `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`
    })
  return { nodes: nodes.slice(0, shown), wires }
})

const pct = (n: number, of: number): string => `${(n / of) * 100}%`
const box = (n: Placed) => ({
  left: pct(n.left, STAGE_W),
  top: pct(n.top, STAGE_H),
  width: pct(n.w, STAGE_W),
  height: pct(n.h, STAGE_H)
})
const promptOf = computed(() => PROMPTS[source.value?.media ?? 'image'] ?? PROMPTS.image)
</script>

<template>
  <div class="gg-stage">
    <svg
      class="gg-wires"
      :viewBox="`0 0 ${STAGE_W} ${STAGE_H}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path v-for="d in graph.wires" :key="d" :d class="gg-wire" />
      <path v-for="d in graph.wires" :key="`p${d}`" :d class="gg-pulse" pathLength="100" />
    </svg>
    <div
      v-for="(n, i) in graph.nodes"
      :key="n.key"
      class="gg-node"
      :class="[`is-col${n.col}`, `is-${n.kind}`]"
      :style="[box(n), { '--i': i }]"
    >
      <p class="gg-node-head">
        <component :is="NODE_ICONS[n.kind]" :size="12" />
        <span class="truncate">{{ n.title }}</span>
      </p>
      <div v-if="n.col === 2" class="gg-out" :class="agent && 'is-empty'">
        <p v-if="agent" class="gg-out-empty">{{ agent.out }}</p>
        <template v-else-if="starter">
          <img :src="starter.poster" alt="" />
          <video
            v-if="starter.clip"
            :key="starter.clip"
            :src="starter.clip"
            muted
            loop
            playsinline
            autoplay
            class="motion-reduce:hidden"
          />
        </template>
        <img v-else-if="workflow?.cover" :src="workflow.cover" alt="" />
        <WorkflowCover v-else-if="workflow" :name="workflow.name" />
      </div>
      <div v-else-if="n.kind === 'image' && agent" class="gg-drop">
        <Upload :size="16" />
        <span>{{ agent.drop }}</span>
      </div>
      <img v-else-if="n.kind === 'image'" :src="mock('asset-actor-ref')" alt="" class="gg-in-pic" />
      <p v-else-if="n.kind === 'prompt'" class="gg-prompt">{{ agent ? agent.prompt : promptOf }}</p>
      <div v-else class="gg-widgets">
        <span><i>steps</i><b>20</b></span>
        <span><i>cfg</i><b>4.0</b></span>
        <span><i>seed</i><b>randomize</b></span>
      </div>
    </div>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .gg-drop {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0 6px 6px;
  border-radius: 8px;
  outline: 1.5px dashed var(--color-border-strong);
  outline-offset: -1.5px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .gg-out.is-empty {
  display: grid;
  place-items: center;
}
:root .proto-ui.proto-ui.proto-ui .gg-out-empty {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .gg-stage {
  position: relative;
  width: 100%;
  max-width: 900px;
  max-height: 100%;
  aspect-ratio: 1000 / 440;
}
:root .proto-ui.proto-ui.proto-ui .gg-wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
:root .proto-ui.proto-ui.proto-ui .gg-wire,
:root .proto-ui.proto-ui.proto-ui .gg-pulse {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
:root .proto-ui.proto-ui.proto-ui .gg-wire {
  stroke: color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
  animation: gg-fade 400ms ease both 120ms;
}
:root .proto-ui.proto-ui.proto-ui .gg-pulse {
  stroke: color-mix(in oklch, var(--color-base-foreground) 70%, transparent);
  stroke-dasharray: 5 95;
  animation: gg-flow 2.6s linear infinite;
}
:root .proto-ui.proto-ui.proto-ui .gg-node {
  position: absolute;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 12%, transparent),
    0 16px 40px -20px oklch(0 0 0 / 0.7);
  backdrop-filter: blur(6px);
  animation: gg-ghost 420ms var(--ease-out-expo) both;
  animation-delay: calc(var(--i, 0) * 60ms);
}
:root .proto-ui.proto-ui.proto-ui .gg-node.is-col2 {
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 22%, transparent),
    0 30px 60px -24px oklch(0 0 0 / 0.8);
}
:root .proto-ui.proto-ui.proto-ui .gg-node-head {
  display: flex;
  height: 30px;
  flex: none;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .gg-out {
  position: relative;
  min-height: 0;
  flex: 1;
  margin: 0 6px 6px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .gg-out > img,
:root .proto-ui.proto-ui.proto-ui .gg-out > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .gg-in-pic {
  min-height: 0;
  flex: 1;
  margin: 0 6px 6px;
  border-radius: 8px;
  object-fit: cover;
  opacity: 0.8;
}
:root .proto-ui.proto-ui.proto-ui .gg-prompt {
  margin: 0 6px 6px;
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: 12px;
  line-height: 17px;
}
:root .proto-ui.proto-ui.proto-ui .gg-widgets {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 6px 6px;
}
:root .proto-ui.proto-ui.proto-ui .gg-widgets span {
  display: flex;
  height: 22px;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--color-secondary-background);
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .gg-widgets i {
  color: var(--color-subtle-foreground);
  font-style: normal;
}
:root .proto-ui.proto-ui.proto-ui .gg-widgets b {
  color: var(--color-muted-foreground);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .gg-out > .wfc {
  position: absolute;
  inset: 0;
}
@keyframes gg-ghost {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
}
@keyframes gg-fade {
  from {
    opacity: 0;
  }
}
@keyframes gg-flow {
  from {
    stroke-dashoffset: 100;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .gg-node,
  :root .proto-ui.proto-ui.proto-ui .gg-wire {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .gg-pulse {
    display: none;
  }
}
</style>
