<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ImageOff } from 'lucide-vue-next'
import type { CatalogWorkflow } from '../../types/ipc'

interface ArcSlot {
  transform: string
  opacity: number
  dim: number
  layer: number
}

const ARC_REACH = 2
const OFFSTAGE = ARC_REACH + 1
const DRAG_PIXELS_PER_CARD = 150
const DRAG_START_PIXELS = 6
const ARC_SLOTS: Record<number, ArcSlot> = {
  0: { transform: 'translateX(0) rotateY(0deg) scale(1)', opacity: 1, dim: 0, layer: 3 },
  1: {
    transform: 'translateX(240px) rotateY(26deg) scale(0.945)',
    opacity: 0.76,
    dim: 0.36,
    layer: 2
  },
  2: {
    transform: 'translateX(396px) rotateY(54deg) scale(0.84)',
    opacity: 0.17,
    dim: 0.72,
    layer: 1
  },
  [OFFSTAGE]: {
    transform: 'translateX(500px) rotateY(72deg) scale(0.74)',
    opacity: 0,
    dim: 0.9,
    layer: 0
  }
}

const { workflows } = defineProps<{
  workflows: readonly CatalogWorkflow[]
}>()

const emit = defineEmits<{ open: [workflow: CatalogWorkflow] }>()

const { t } = useI18n()

const frontPosition = ref(0)
const jumpedAcross = ref(new Set<string>())
const loadedThumbnails = ref(new Set<string>())
const brokenThumbnails = ref(new Set<string>())

const wraps = computed(() => workflows.length > ARC_REACH * 2)

function offsetFrom(position: number, index: number): number {
  const count = workflows.length
  const distance = index - position
  if (!wraps.value) return distance
  const turned = ((distance % count) + count) % count
  return turned > count / 2 ? turned - count : turned
}

const arcCards = computed(() =>
  workflows.map((workflow, index) => {
    const offset = offsetFrom(frontPosition.value, index)
    return { workflow, offset, onStage: Math.abs(offset) <= ARC_REACH }
  })
)

function moveTo(position: number): void {
  const last = workflows.length - 1
  const next = wraps.value ? position : Math.min(Math.max(position, 0), last)
  const moved = next - frontPosition.value
  if (moved === 0) return
  jumpedAcross.value = new Set(
    workflows
      .filter(
        (_workflow, index) =>
          offsetFrom(next, index) !== offsetFrom(frontPosition.value, index) - moved
      )
      .map((workflow) => workflow.id)
  )
  frontPosition.value = next
}

watch(
  () => workflows.length,
  () => {
    jumpedAcross.value = new Set(workflows.map((workflow) => workflow.id))
    frontPosition.value = 0
  }
)

function slotStyle(offset: number): Record<string, string> {
  const slot = ARC_SLOTS[Math.min(Math.abs(offset), OFFSTAGE)]!
  const mirrored = offset < 0
  return {
    transform: mirrored
      ? slot.transform.replace('translateX(', 'translateX(-').replace('rotateY(', 'rotateY(-')
      : slot.transform,
    opacity: String(slot.opacity),
    zIndex: String(slot.layer),
    '--arc-dim': String(slot.dim)
  }
}

function showsThumbnail(workflow: CatalogWorkflow): boolean {
  return workflow.thumbnailUrl !== null && !brokenThumbnails.value.has(workflow.id)
}

function markThumbnailLoaded(workflow: CatalogWorkflow): void {
  loadedThumbnails.value = new Set(loadedThumbnails.value).add(workflow.id)
}

function markThumbnailBroken(workflow: CatalogWorkflow): void {
  brokenThumbnails.value = new Set(brokenThumbnails.value).add(workflow.id)
}

const dragging = ref(false)
let dragStartX = 0
let dragStartPosition = 0
let clickBelongsToDrag = false

function onDragMove(event: PointerEvent): void {
  const distance = event.clientX - dragStartX
  if (!dragging.value && Math.abs(distance) < DRAG_START_PIXELS) return
  dragging.value = true
  moveTo(dragStartPosition - Math.round(distance / DRAG_PIXELS_PER_CARD))
}

function stopDrag(): void {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointercancel', stopDrag)
  if (!dragging.value) return
  dragging.value = false
  clickBelongsToDrag = true
  setTimeout(() => {
    clickBelongsToDrag = false
  }, 0)
}

function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return
  dragStartX = event.clientX
  dragStartPosition = frontPosition.value
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
}

onBeforeUnmount(stopDrag)

function activate(card: { workflow: CatalogWorkflow; offset: number }): void {
  if (clickBelongsToDrag) return
  if (card.offset === 0) emit('open', card.workflow)
  else moveTo(frontPosition.value + card.offset)
}
</script>

<template>
  <ul
    class="relative m-0 h-75 w-full touch-pan-y list-none p-0 select-none [perspective:3000px]"
    :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
    data-testid="home-workflow-carousel"
    @pointerdown="startDrag"
    @keydown.left.prevent="moveTo(frontPosition - 1)"
    @keydown.right.prevent="moveTo(frontPosition + 1)"
  >
    <li v-for="card in arcCards" :key="card.workflow.id" class="contents">
      <button
        type="button"
        class="absolute top-0 left-1/2 -ml-32 h-75 w-64 cursor-[inherit] overflow-hidden rounded-[18px] border-0 bg-[#1d1d1d] p-0 text-left shadow-[0_28px_56px_rgb(0_0_0/0.8)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="[
          jumpedAcross.has(card.workflow.id)
            ? 'transition-none'
            : 'transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          !card.onStage && 'pointer-events-none'
        ]"
        :style="slotStyle(card.offset)"
        :aria-label="
          card.offset === 0
            ? t('home.openWorkflow', { title: card.workflow.title })
            : t('home.showWorkflow', { title: card.workflow.title })
        "
        :aria-current="card.offset === 0 ? 'true' : undefined"
        :aria-hidden="card.onStage ? undefined : 'true'"
        :tabindex="card.onStage ? undefined : -1"
        data-testid="home-workflow-card"
        :data-arc-offset="card.offset"
        @click="activate(card)"
      >
        <img
          v-if="showsThumbnail(card.workflow)"
          :src="card.workflow.thumbnailUrl ?? undefined"
          alt=""
          draggable="false"
          class="absolute inset-0 size-full object-cover transition-opacity duration-300 motion-reduce:transition-none"
          :class="loadedThumbnails.has(card.workflow.id) ? 'opacity-100' : 'opacity-0'"
          :data-loaded="loadedThumbnails.has(card.workflow.id)"
          @load="markThumbnailLoaded(card.workflow)"
          @error="markThumbnailBroken(card.workflow)"
        />
        <span
          v-else
          class="absolute inset-0 flex items-center justify-center text-subtle-foreground"
        >
          <ImageOff :size="22" aria-hidden="true" />
        </span>
        <span
          class="absolute inset-x-0 top-0 h-[45%] bg-linear-to-b from-black/62 via-black/28 via-55% to-transparent"
          aria-hidden="true"
        />
        <span
          class="absolute inset-0 bg-linear-to-t from-black/75 via-black/40 via-30% to-transparent to-55%"
          aria-hidden="true"
        />
        <span class="absolute inset-x-3.5 bottom-4 flex flex-col">
          <span class="truncate text-sm/[17px] font-medium text-white">
            {{ card.workflow.title }}
          </span>
          <span v-if="card.workflow.description" class="truncate text-[13px]/[18px] text-white/70">
            {{ card.workflow.description }}
          </span>
        </span>
        <span
          class="pointer-events-none absolute inset-0 bg-[#090909] opacity-(--arc-dim) transition-opacity duration-500 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </button>
    </li>
  </ul>
</template>
