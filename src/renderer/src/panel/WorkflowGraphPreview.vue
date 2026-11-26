<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import {
  GRAPH_TITLE_HEIGHT,
  GRAPH_WIDGET_HEIGHT,
  layOutGraph,
  linkColor
} from './workflowGraphLayout'

const PADDING = 24

const { graph, zoom } = defineProps<{
  graph: Record<string, unknown> | null
  zoom: 'fit' | number
}>()

const emit = defineEmits<{ scale: [percent: number | null] }>()

const frame = ref<HTMLElement | null>(null)
const { width: frameWidth, height: frameHeight } = useElementSize(frame)
const layout = computed(() => layOutGraph(graph))
const pan = ref({ x: 0, y: 0 })
let dragFrom: { x: number; y: number; pan: { x: number; y: number } } | null = null

const fitScale = computed(() => {
  const bounds = layout.value?.bounds
  if (!bounds || frameWidth.value === 0 || frameHeight.value === 0) return 1
  return Math.min(
    (frameWidth.value - PADDING * 2) / bounds.width,
    (frameHeight.value - PADDING * 2) / bounds.height,
    1
  )
})
const scale = computed(() => (zoom === 'fit' ? fitScale.value : zoom / 100))

const transform = computed(() => {
  const bounds = layout.value?.bounds
  if (!bounds) return ''
  const left = (frameWidth.value - bounds.width * scale.value) / 2 - bounds.x * scale.value
  const top = (frameHeight.value - bounds.height * scale.value) / 2 - bounds.y * scale.value
  return `translate(${left + pan.value.x} ${top + pan.value.y}) scale(${scale.value})`
})

watch(
  [scale, layout],
  ([value, drawn]) => {
    emit('scale', drawn ? Math.round(value * 100) : null)
  },
  { immediate: true }
)

watch(
  () => [zoom, graph],
  () => {
    pan.value = { x: 0, y: 0 }
  }
)

function startDrag(event: PointerEvent): void {
  dragFrom = { x: event.clientX, y: event.clientY, pan: { ...pan.value } }
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
}

function drag(event: PointerEvent): void {
  if (!dragFrom) return
  pan.value = {
    x: dragFrom.pan.x + event.clientX - dragFrom.x,
    y: dragFrom.pan.y + event.clientY - dragFrom.y
  }
}

function endDrag(): void {
  dragFrom = null
}
</script>

<template>
  <div
    ref="frame"
    class="relative size-full cursor-grab overflow-hidden active:cursor-grabbing"
    data-testid="workflow-graph"
    @pointerdown="startDrag"
    @pointermove="drag"
    @pointerup="endDrag"
    @pointercancel="endDrag"
  >
    <svg v-if="layout" class="absolute inset-0 size-full select-none" aria-hidden="true">
      <g :transform="transform">
        <g v-for="(group, index) in layout.groups" :key="`group-${index}`">
          <rect
            :x="group.x"
            :y="group.y"
            :width="group.width"
            :height="group.height"
            rx="8"
            :fill="group.color"
            fill-opacity="0.12"
            :stroke="group.color"
            stroke-opacity="0.35"
          />
          <text :x="group.x + 10" :y="group.y + 22" fill="#d4d4d4" font-size="16" font-weight="600">
            {{ group.title }}
          </text>
        </g>
        <path
          v-for="link in layout.links"
          :key="`link-${link.id}`"
          :d="link.path"
          fill="none"
          :stroke="linkColor(link.type)"
          stroke-width="2.5"
          stroke-opacity="0.9"
        />
        <g
          v-for="node in layout.nodes"
          :key="`node-${node.id}`"
          :opacity="node.muted ? 0.45 : 1"
          data-testid="workflow-graph-node"
        >
          <rect
            :x="node.x"
            :y="node.y - GRAPH_TITLE_HEIGHT"
            :width="node.width"
            :height="node.height + GRAPH_TITLE_HEIGHT"
            rx="8"
            fill="#1b1b1b"
            stroke="#2e2e2e"
          />
          <circle :cx="node.x + 12" :cy="node.y - GRAPH_TITLE_HEIGHT / 2" r="3" fill="#8a8a8a" />
          <text
            :x="node.x + 22"
            :y="node.y - GRAPH_TITLE_HEIGHT / 2 + 4"
            fill="#e6e6e6"
            font-size="12"
            font-weight="600"
          >
            {{ node.title }}
          </text>
          <g v-for="(slot, index) in node.inputs" :key="`in-${index}`">
            <circle :cx="slot.x" :cy="slot.y" r="4" :fill="linkColor(slot.type)" />
            <text :x="slot.x + 10" :y="slot.y + 4" fill="#a3a3a3" font-size="10">
              {{ slot.name }}
            </text>
          </g>
          <g v-for="(slot, index) in node.outputs" :key="`out-${index}`">
            <circle :cx="slot.x" :cy="slot.y" r="4" :fill="linkColor(slot.type)" />
            <text :x="slot.x - 10" :y="slot.y + 4" fill="#a3a3a3" font-size="10" text-anchor="end">
              {{ slot.name }}
            </text>
          </g>
          <g v-for="(widget, index) in node.widgets" :key="`widget-${index}`">
            <rect
              :x="node.x + 8"
              :y="widget.y"
              :width="node.width - 16"
              :height="GRAPH_WIDGET_HEIGHT"
              rx="5"
              fill="#111111"
            />
            <text :x="node.x + 14" :y="widget.y + 12.5" fill="#8a8a8a" font-size="9">
              {{ widget.label }}
            </text>
            <text
              :x="node.x + node.width - 14"
              :y="widget.y + 12.5"
              fill="#d4d4d4"
              font-size="9"
              text-anchor="end"
            >
              {{ widget.value }}
            </text>
          </g>
        </g>
      </g>
    </svg>
    <slot v-else />
  </div>
</template>
