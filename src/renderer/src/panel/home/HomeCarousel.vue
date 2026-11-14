<script setup lang="ts" generic="Card extends { id: string; title: string; description: string }">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, ImageOff } from 'lucide-vue-next'

interface ArcSlot {
  transform: string
  opacity: number
  dim: number
  layer: number
}

const STEP_CLASS =
  'absolute top-[150px] z-10 grid size-9 -translate-y-1/2 place-items-center rounded-[8px] border-0 bg-transparent p-0 text-muted-foreground opacity-50 outline-none transition-[opacity,background-color,color] duration-200 group-hover/arc:opacity-90 hover:bg-foreground/7 hover:text-foreground hover:opacity-100 focus-visible:bg-foreground/7 focus-visible:text-foreground focus-visible:opacity-100 active:scale-94 disabled:pointer-events-none disabled:opacity-0 motion-reduce:transition-none'

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

const { cards, kind, pictureOf } = defineProps<{
  cards: readonly Card[]
  kind: 'apps' | 'workflows'
  pictureOf: (card: Card) => string | null
}>()

const emit = defineEmits<{ open: [card: Card] }>()

const { t } = useI18n()

const frontPosition = ref(0)
const jumpedAcross = ref(new Set<string>())
const loadedPictures = ref(new Set<string>())
const brokenPictures = ref(new Set<string>())

const opensInDesktop = computed(() => kind === 'apps')
const wraps = computed(() => cards.length > ARC_REACH * 2)
const atFirst = computed(() => !wraps.value && frontPosition.value === 0)
const atLast = computed(() => !wraps.value && frontPosition.value === cards.length - 1)

const arc = useTemplateRef<HTMLUListElement>('arc')
const stepButtons = useTemplateRef<HTMLButtonElement[]>('stepButtons')

const steps = computed(() => [
  {
    direction: -1,
    label: opensInDesktop.value ? t('home.previousApp') : t('home.previousWorkflow'),
    icon: ChevronLeft,
    side: 'left-[max(8px,calc(50%-420px))]',
    disabled: atFirst.value,
    testId: 'home-carousel-previous'
  },
  {
    direction: 1,
    label: opensInDesktop.value ? t('home.nextApp') : t('home.nextWorkflow'),
    icon: ChevronRight,
    side: 'right-[max(8px,calc(50%-420px))]',
    disabled: atLast.value,
    testId: 'home-carousel-next'
  }
])

function offsetFrom(position: number, index: number): number {
  const count = cards.length
  const distance = index - position
  if (!wraps.value) return distance
  const turned = ((distance % count) + count) % count
  return turned > count / 2 ? turned - count : turned
}

const arcCards = computed(() =>
  cards.map((card, index) => {
    const offset = offsetFrom(frontPosition.value, index)
    return { card, offset, onStage: Math.abs(offset) <= ARC_REACH }
  })
)

function moveTo(position: number): void {
  const last = cards.length - 1
  const next = wraps.value ? position : Math.min(Math.max(position, 0), last)
  const moved = next - frontPosition.value
  if (moved === 0) return
  jumpedAcross.value = new Set(
    cards
      .filter(
        (_card, index) => offsetFrom(next, index) !== offsetFrom(frontPosition.value, index) - moved
      )
      .map((card) => card.id)
  )
  frontPosition.value = next
}

watch(
  () => cards.length,
  () => {
    jumpedAcross.value = new Set(cards.map((card) => card.id))
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

function showsPicture(card: Card): boolean {
  return pictureOf(card) !== null && !brokenPictures.value.has(card.id)
}

function markPictureLoaded(card: Card): void {
  loadedPictures.value = new Set(loadedPictures.value).add(card.id)
}

function markPictureBroken(card: Card): void {
  brokenPictures.value = new Set(brokenPictures.value).add(card.id)
}

function labelFor(placed: { card: Card; offset: number }): string {
  const { title } = placed.card
  if (placed.offset !== 0) {
    return opensInDesktop.value ? t('home.showApp', { title }) : t('home.showWorkflow', { title })
  }
  return opensInDesktop.value ? t('home.openApp', { title }) : t('home.openWorkflow', { title })
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

async function turn(direction: number): Promise<void> {
  const focused = document.activeElement
  const cardHadFocus = arc.value?.contains(focused) ?? false
  const focusedArrow = stepButtons.value?.find((button) => button === focused)
  moveTo(frontPosition.value + direction)
  await nextTick()
  if (cardHadFocus) arc.value?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus()
  else if (focusedArrow?.disabled) stepButtons.value?.find((button) => !button.disabled)?.focus()
}

function activate(placed: { card: Card; offset: number }): void {
  if (clickBelongsToDrag) return
  if (placed.offset === 0) emit('open', placed.card)
  else moveTo(frontPosition.value + placed.offset)
}
</script>

<template>
  <div class="group/arc relative" @keydown.left.prevent="turn(-1)" @keydown.right.prevent="turn(1)">
    <ul
      ref="arc"
      class="relative m-0 h-75 w-full touch-pan-y list-none p-0 select-none [perspective:3000px]"
      :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
      data-testid="home-carousel"
      @pointerdown="startDrag"
    >
      <li v-for="placed in arcCards" :key="placed.card.id" class="contents">
        <button
          type="button"
          class="group/card absolute top-0 left-1/2 -ml-32 h-75 w-64 cursor-[inherit] overflow-hidden rounded-[18px] border-0 bg-[#1d1d1d] p-0 text-left shadow-[0_28px_56px_rgb(0_0_0/0.8)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="[
            jumpedAcross.has(placed.card.id)
              ? 'transition-none'
              : 'transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            !placed.onStage && 'pointer-events-none'
          ]"
          :style="slotStyle(placed.offset)"
          :aria-label="labelFor(placed)"
          :aria-current="placed.offset === 0 ? 'true' : undefined"
          :aria-hidden="placed.onStage ? undefined : 'true'"
          :tabindex="placed.onStage ? undefined : -1"
          data-testid="home-carousel-card"
          :data-arc-offset="placed.offset"
          @click="activate(placed)"
        >
          <img
            v-if="showsPicture(placed.card)"
            :src="pictureOf(placed.card) ?? undefined"
            alt=""
            draggable="false"
            class="absolute inset-0 size-full object-cover transition-opacity duration-300 motion-reduce:transition-none"
            :class="loadedPictures.has(placed.card.id) ? 'opacity-100' : 'opacity-0'"
            :data-loaded="loadedPictures.has(placed.card.id)"
            @load="markPictureLoaded(placed.card)"
            @error="markPictureBroken(placed.card)"
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
          <span
            v-if="opensInDesktop"
            class="absolute top-[17px] left-4 text-xs/[17px] font-semibold tracking-[0.06em] text-white/78 uppercase"
            aria-hidden="true"
            data-testid="home-carousel-kind"
          >
            {{ t('home.appLabel') }}
          </span>
          <span
            class="absolute top-3 right-3 grid size-8 place-items-center rounded-[9px] bg-white/20 text-white opacity-0 backdrop-blur-[14px] backdrop-saturate-150 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            :class="
              placed.offset === 0
                ? 'scale-90 group-hover/card:scale-100 group-hover/card:opacity-100 group-hover/card:delay-100 group-focus-visible/card:scale-100 group-focus-visible/card:opacity-100'
                : 'scale-90'
            "
            aria-hidden="true"
            data-testid="home-carousel-cta"
          >
            <component
              :is="opensInDesktop ? ArrowRight : ArrowUpRight"
              :size="16"
              :stroke-width="2.25"
            />
          </span>
          <span
            class="absolute inset-x-3.5 bottom-4 flex flex-col"
            data-testid="home-carousel-name"
          >
            <span class="truncate text-sm/[17px] font-medium text-white">
              {{ placed.card.title }}
            </span>
            <span v-if="placed.card.description" class="truncate text-[13px]/[18px] text-white/70">
              {{ placed.card.description }}
            </span>
          </span>
          <span
            class="pointer-events-none absolute inset-0 bg-[#090909] opacity-(--arc-dim) transition-opacity duration-500 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>
    <template v-if="cards.length > 1">
      <button
        v-for="arrow in steps"
        :key="arrow.direction"
        ref="stepButtons"
        type="button"
        :class="[STEP_CLASS, arrow.side]"
        :aria-label="arrow.label"
        :disabled="arrow.disabled"
        :data-testid="arrow.testId"
        @click="turn(arrow.direction)"
      >
        <component :is="arrow.icon" :size="20" aria-hidden="true" />
      </button>
    </template>
  </div>
</template>
