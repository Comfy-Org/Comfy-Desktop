<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Minus, Plus } from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'
import Tooltip from '../../ui/Tooltip.vue'
import { ComfyCompare } from '../icons/comfyIcons'

/**
 * Zoom, as ComfyUI's canvas has it: Compare beside the percentage when
 * there is a before, and the percentage opening a slider (− track +) over
 * Zoom in, Zoom out, Zoom 100% and Zoom to fit, each with its shortcut.
 * Used by the asset modal and the app editor, so they read the same.
 * `zoom` scales the fitted picture (100 = fit); the control reads in real
 * size, the fitted picture's width over the file's (`fit`).
 */
const zoom = defineModel<number>({ required: true })
// Absent unless the view has a before (a boolean prop would read false).
const compare = defineModel<boolean | undefined>('compare', { default: undefined })
const { fit = 1, keys = false } = defineProps<{
  fit?: number
  /** Listen for the shortcuts while this control's view is in front. */
  keys?: boolean
}>()

const open = ref(false)
const box = ref<HTMLElement>()
onClickOutside(box, () => (open.value = false))

const shown = computed(() => Math.round(fit * zoom.value))
const set = (pct: number): void => {
  zoom.value = Math.min(800, Math.max(10, pct / fit))
}
const STEPS = [10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400]
const zoomIn = (): void => set(STEPS.find((s) => s > shown.value) ?? 400)
const zoomOut = (): void => set([...STEPS].reverse().find((s) => s < shown.value) ?? 10)
const real = (): void => set(100)
const toFit = (): void => {
  zoom.value = 100
}

const mac = /Mac|iPhone|iPad/.test(navigator.platform)
const mod = mac ? '⌘' : 'Ctrl'
const ITEMS = [
  { label: 'Zoom in', keys: [mod, '+'], run: zoomIn },
  { label: 'Zoom out', keys: [mod, '−'], run: zoomOut },
  { label: 'Zoom 100%', keys: [mod, '0'], run: real },
  { label: 'Zoom to fit', keys: ['D'], run: toFit }
]

function onKey(e: KeyboardEvent): void {
  const t = e.target
  if (t instanceof HTMLElement && t.closest('input, textarea, [contenteditable="true"]')) return
  // A modal over this view takes the keys (the asset modal over an app).
  const modal = document.querySelector('[aria-modal="true"]')
  if (modal && !modal.contains(box.value ?? null)) return
  const cmd = e.metaKey || e.ctrlKey
  if (cmd && (e.key === '=' || e.key === '+')) zoomIn()
  else if (cmd && e.key === '-') zoomOut()
  else if (cmd && e.key === '0') real()
  else if (!cmd && !e.altKey && e.key.toLowerCase() === 'd') toFit()
  else return
  e.preventDefault()
}
onMounted(() => keys && window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

defineExpose({ open })
</script>

<template>
  <div ref="box" class="zc" role="group" aria-label="Zoom">
    <Tooltip v-if="compare !== undefined" content="Compare">
      <button
        type="button"
        class="zc-btn"
        :class="compare && 'is-on'"
        aria-label="Compare before and after"
        :aria-pressed="compare"
        @click="compare = !compare"
      >
        <ComfyCompare :size="16" />
      </button>
    </Tooltip>
    <button
      type="button"
      class="zc-btn zc-pct"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span>{{ shown }}%</span>
      <svg class="zc-caret" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 3.5h6L5 7z" fill="currentColor" />
      </svg>
    </button>
    <Transition name="zc-pop">
      <div v-if="open" class="zc-menu" role="menu">
        <button
          v-for="i in ITEMS"
          :key="i.label"
          type="button"
          role="menuitem"
          class="zc-row"
          @click="i.run"
        >
          <span>{{ i.label }}</span>
          <kbd class="zc-kbd"
            ><span v-for="k in i.keys" :key="k">{{ k }}</span></kbd
          >
        </button>
        <div class="zc-slide">
          <button type="button" class="zc-step" aria-label="Zoom out" @click="zoomOut">
            <Minus :size="13" />
          </button>
          <input
            class="zc-range"
            type="range"
            min="10"
            max="400"
            step="1"
            :value="shown"
            :style="{ '--zc-at': `${((shown - 10) / 390) * 100}%` }"
            aria-label="Zoom"
            @input="set(Number(($event.target as HTMLInputElement).value))"
          />
          <button type="button" class="zc-step" aria-label="Zoom in" @click="zoomIn">
            <Plus :size="13" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style>
.zc {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .zc-btn {
  display: inline-flex;
  height: 28px;
  min-width: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .zc-btn:hover,
:root .proto-ui.proto-ui.proto-ui .zc-btn.is-on,
:root .proto-ui.proto-ui.proto-ui .zc-btn[aria-expanded='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .zc-pct {
  gap: 6px;
  padding: 0 8px 0 10px;
  font-size: 13px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.zc-pct > span {
  min-width: 34px;
  text-align: center;
}
.zc-caret {
  width: 10px;
  height: 10px;
  transition: rotate 150ms ease-out;
}
.zc-pct[aria-expanded='true'] .zc-caret {
  rotate: 180deg;
}
.zc-menu {
  position: absolute;
  z-index: 3;
  right: 0;
  bottom: calc(100% + 6px);
  display: grid;
  width: 224px;
  padding: 6px;
  border-radius: 12px;
  background: var(--color-secondary-background);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
}
/* DS Motion › Menu enter, grown from the percentage below it (the shared
   menu rise in motion.css drops from the top, so it is replaced here), and
   a quicker fade back into it on close. */
:root .zc .zc-menu[role='menu'] {
  transform-origin: bottom right;
  animation: none;
}
.zc-pop-enter-active {
  transition:
    opacity 180ms var(--mar-ease, cubic-bezier(0.16, 1, 0.3, 1)),
    transform 180ms var(--mar-ease, cubic-bezier(0.16, 1, 0.3, 1));
}
.zc-pop-leave-active {
  transition:
    opacity 120ms ease-in,
    transform 120ms ease-in;
}
.zc-pop-enter-from,
.zc-pop-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.96);
}
@media (prefers-reduced-motion: reduce) {
  .zc-pop-enter-from,
  .zc-pop-leave-to {
    transform: none;
  }
}
/* − track +: the same round steps as the Layout menu's Size. Last, next to
   the percentage that opened it, so the most used control is the closest. */
.zc-slide {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px 6px;
}
:root .proto-ui.proto-ui.proto-ui .zc-step {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .zc-step:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .zc-range {
  height: 16px;
  min-width: 0;
  flex: 1;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
/* The thumb shows focus; the track never gets the page's focus outline. */
:root .proto-ui.proto-ui.proto-ui .zc-range:focus,
:root .proto-ui.proto-ui.proto-ui .zc-range:focus-visible {
  outline: none;
  box-shadow: none;
}
.zc-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--color-base-foreground) var(--zc-at),
    color-mix(in oklch, var(--color-base-foreground) 14%, transparent) var(--zc-at)
  );
}
.zc-range::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 999px;
  appearance: none;
  background: var(--color-base-foreground);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
}
.zc-range:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-base-foreground) 30%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .zc-row {
  display: flex;
  height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 10px;
  border-radius: 7px;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 13px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .zc-row:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.zc-kbd {
  display: inline-flex;
  gap: 4px;
  color: var(--color-subtle-foreground);
  font-family: inherit;
  font-size: 12px;
}
</style>
