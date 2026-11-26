<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import { ChevronDown, Minus, Plus } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'

export type AssetZoom = 'fit' | number

const MIN_PERCENT = 10
const MAX_PERCENT = 400
const STEPS = [10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400]

const zoom = defineModel<AssetZoom>({ required: true })
const { fitScale } = defineProps<{ fitScale: number }>()

const { t } = useI18n()

const shownPercent = computed(() =>
  Math.round((zoom.value === 'fit' ? fitScale : zoom.value) * 100)
)
const modKey = window.api.platform === 'darwin' ? '⌘' : 'Ctrl'

function setPercent(percent: number): void {
  zoom.value = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, percent)) / 100
}

function zoomIn(): void {
  setPercent(STEPS.find((step) => step > shownPercent.value) ?? MAX_PERCENT)
}

function zoomOut(): void {
  setPercent(STEPS.findLast((step) => step < shownPercent.value) ?? MIN_PERCENT)
}

function zoomToActualSize(): void {
  setPercent(100)
}

function zoomToFit(): void {
  zoom.value = 'fit'
}

const actions = computed(() => [
  { id: 'in', label: t('assets.detail.zoomIn'), keys: [modKey, '+'], run: zoomIn },
  { id: 'out', label: t('assets.detail.zoomOut'), keys: [modKey, '−'], run: zoomOut },
  {
    id: 'actual',
    label: t('assets.detail.zoomActual'),
    keys: [modKey, '0'],
    run: zoomToActualSize
  },
  { id: 'fit', label: t('assets.detail.zoomFit'), keys: ['D'], run: zoomToFit }
])

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.defaultPrevented || event.altKey) return
  const target = event.target
  if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]'))
    return
  const command = event.metaKey || event.ctrlKey
  if (command && (event.key === '=' || event.key === '+')) zoomIn()
  else if (command && event.key === '-') zoomOut()
  else if (command && event.key === '0') zoomToActualSize()
  else if (!command && event.key.toLowerCase() === 'd') zoomToFit()
  else return
  event.preventDefault()
})
</script>

<template>
  <Menu
    :modal="false"
    align="end"
    side="top"
    :side-offset="6"
    class="z-70 w-56"
    :aria-label="t('assets.detail.zoom')"
  >
    <template #trigger>
      <Button
        type="button"
        variant="secondary"
        size="md"
        class="gap-1.5 pr-2 pl-2.5 text-[13px]/5 font-medium tabular-nums"
        :aria-label="t('assets.detail.zoomLevel', { level: `${shownPercent}%` })"
        data-testid="output-detail-zoom"
      >
        <span class="min-w-[34px] text-center">{{ shownPercent }}%</span>
        <ChevronDown :size="13" aria-hidden="true" />
      </Button>
    </template>
    <MenuItem
      v-for="action in actions"
      :key="action.id"
      as="button"
      type="button"
      class="w-full"
      :data-testid="`output-detail-zoom-${action.id}`"
      @select.prevent="action.run()"
    >
      <span class="flex-1 text-left">{{ action.label }}</span>
      <kbd class="flex gap-0.5 font-sans text-[11px] text-subtle-foreground">
        <span v-for="key in action.keys" :key="key">{{ key }}</span>
      </kbd>
    </MenuItem>
    <div class="flex items-center gap-2 px-1 pt-2 pb-1.5">
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        class="size-6 rounded-full"
        :aria-label="t('assets.detail.zoomOut')"
        @click="zoomOut"
      >
        <Minus :size="13" aria-hidden="true" />
      </Button>
      <input
        type="range"
        class="h-4 min-w-0 flex-1 cursor-pointer accent-foreground"
        :min="MIN_PERCENT"
        :max="MAX_PERCENT"
        step="1"
        :value="shownPercent"
        :aria-label="t('assets.detail.zoom')"
        data-testid="output-detail-zoom-slider"
        @input="setPercent(Number(($event.target as HTMLInputElement).value))"
      />
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        class="size-6 rounded-full"
        :aria-label="t('assets.detail.zoomIn')"
        @click="zoomIn"
      >
        <Plus :size="13" aria-hidden="true" />
      </Button>
    </div>
  </Menu>
</template>
