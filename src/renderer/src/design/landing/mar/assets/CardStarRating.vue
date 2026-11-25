<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { Star } from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'
import { MAX_STARS } from './assetRating'

const { value } = defineProps<{ value: number }>()
const emit = defineEmits<{ set: [n: number] }>()

const STARS = Array.from({ length: MAX_STARS }, (_, i) => i + 1)

const open = ref(false)
const hover = ref(0)
const focused = ref(0)
const root = useTemplateRef<HTMLElement>('root')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const radios = useTemplateRef<HTMLButtonElement[]>('radios')

const shown = computed(() => hover.value || value)
const label = computed(() => (value ? `Rated ${value} of ${MAX_STARS}` : 'Rate this file'))
const starLabel = (n: number): string => `${n} star${n > 1 ? 's' : ''}`

onClickOutside(root, (e) => {
  if (!open.value) return
  collapse(false)
  if (e.target instanceof Element && e.target.closest('.mar-item')) {
    e.preventDefault()
    e.stopPropagation()
  }
})

async function expand(): Promise<void> {
  open.value = true
  hover.value = 0
  await nextTick()
  focusStar(value || 1)
}

function collapse(refocus: boolean): void {
  open.value = false
  hover.value = 0
  focused.value = 0
  if (refocus) nextTick(() => trigger.value?.focus())
}

function pick(n: number): void {
  emit('set', n === value ? 0 : n)
  collapse(true)
}

function focusStar(n: number): void {
  const at = Math.max(1, Math.min(MAX_STARS, n))
  focused.value = at
  radios.value?.[at - 1]?.focus()
}

const STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1
}

function onKey(e: KeyboardEvent): void {
  if (!open.value) return
  const at = focused.value || value || 1
  if (e.key === 'Escape') collapse(true)
  else if (e.key in STEP) focusStar(at + STEP[e.key]!)
  else if (e.key === 'Home') focusStar(1)
  else if (e.key === 'End') focusStar(MAX_STARS)
  else if (/^[1-9]$/.test(e.key) && Number(e.key) <= MAX_STARS) pick(Number(e.key))
  else if (e.key === '0') pick(value)
  else if (e.key === 'Tab') collapse(false)
  else return
  if (e.key !== 'Tab') e.preventDefault()
  e.stopPropagation()
}

function onFocusStar(n: number): void {
  focused.value = n
  hover.value = n
}
</script>

<template>
  <span
    ref="root"
    class="mar-rate"
    :class="[open && 'is-open', value > 0 && 'is-rated']"
    @click.stop
    @dblclick.stop
    @keydown="onKey"
  >
    <button
      v-if="!open"
      ref="trigger"
      type="button"
      class="mar-rate-trigger"
      :aria-expanded="false"
      :aria-label="label"
      :title="label"
      @click="expand"
      @keydown.enter.stop
      @keydown.space.stop
    >
      <Star :size="13" :fill="value ? 'currentColor' : 'none'" class="mar-rate-glyph" />
      <span v-if="value" class="mar-rate-count">{{ value }}</span>
    </button>
    <span
      v-else
      class="mar-rate-group"
      role="radiogroup"
      :aria-label="label"
      @mouseleave="hover = focused"
    >
      <button
        v-for="n in STARS"
        ref="radios"
        :key="n"
        type="button"
        role="radio"
        class="mar-rate-star"
        :class="n <= shown && 'is-lit'"
        :aria-checked="n === value"
        :aria-label="starLabel(n)"
        :tabindex="n === (focused || value || 1) ? 0 : -1"
        @mouseenter="hover = n"
        @focus="onFocusStar(n)"
        @click="pick(n)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <Star :size="14" :fill="n <= shown ? 'currentColor' : 'none'" />
      </button>
    </span>
  </span>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-rate {
  --mar-rate-w: 26px;
  position: relative;
  display: inline-flex;
  width: var(--mar-rate-w);
  min-width: 0;
  height: 26px;
  flex-shrink: 1;
  align-items: center;
  justify-content: flex-end;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
  color: rgb(255 255 255 / 0.92);
  opacity: 0;
  transition:
    width 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-rate.is-rated {
  --mar-rate-w: 40px;
}
:root .proto-ui.proto-ui.proto-ui .mar-rate.is-open {
  --mar-rate-w: 112px;
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mar-item:is(:hover, :focus-within, .is-menu) .mar-rate {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mar-item-tools:has(.mar-rate.is-open) {
  left: 8px;
  justify-content: flex-end;
}
:root .proto-ui.proto-ui.proto-ui .mar-item:has(.mar-rate.is-open) {
  background: color-mix(in oklch, var(--color-card-background-hover) 80%, transparent);
}
:root
  .proto-ui.proto-ui.proto-ui
  .mar-item:has(.mar-rate.is-open)
  :is(.mar-item-tools .mar-kebab, .mar-item-check) {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mar-rate-trigger {
  display: inline-flex;
  width: 100%;
  height: 100%;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background-color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-rate-trigger:hover {
  background: rgb(255 255 255 / 0.12);
}
:root .proto-ui.proto-ui.proto-ui .mar-rate.is-rated .mar-rate-glyph {
  color: oklch(0.85 0.15 85);
}
.mar-rate-count {
  min-width: 7px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.mar-rate-group {
  display: inline-flex;
  height: 100%;
  flex-shrink: 0;
  align-items: center;
  padding: 0 3px;
  animation: mar-rate-in 180ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .mar-rate-star {
  display: inline-flex;
  width: 21px;
  height: 22px;
  min-width: 14px;
  flex: 0 1 21px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(255 255 255 / 0.7);
  cursor: pointer;
  transition:
    color 100ms ease,
    transform 100ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-rate-star.is-lit {
  color: oklch(0.85 0.15 85);
}
:root .proto-ui.proto-ui.proto-ui .mar-rate-star:hover {
  transform: scale(1.15);
}
:root .proto-ui.proto-ui.proto-ui :is(.mar-rate-trigger, .mar-rate-star):focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.9);
}
@keyframes mar-rate-in {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .mar-rate,
  :root .proto-ui.proto-ui.proto-ui .mar-rate-star {
    transition: none;
  }
  .mar-rate-group {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .mar-rate-star:hover {
    transform: none;
  }
}
</style>
