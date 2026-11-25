<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, Moon, SlidersHorizontal, Sun } from 'lucide-vue-next'
import { look } from '../look'
import { proto } from '../useProto'
import { MILESTONES } from '../milestones'
import { prototypeGroups } from '../prototypeOptions'
import Seg from './tuner/TunerSeg.vue'

/**
 * Browser preview, Mar's proposal: the Prototype controls as a sliders
 * button in the title bar (as in the desktop app) with a dropdown, instead
 * of the floating panel at the bottom left. Options wrap, so long groups
 * (Customize) never overflow. The theme sits beside UI Playground, on its
 * row.
 */
const open = ref(false)
const root = ref<HTMLElement>()
const groups = (): typeof prototypeGroups.value =>
  prototypeGroups.value.slice(1).filter((g) => g.key !== 'theme')
const THEMES = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun }
] as const

function onPointer(e: PointerEvent): void {
  if (open.value && !root.value?.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => {
  window.addEventListener('pointerdown', onPointer)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointer)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <span ref="root" class="relative flex">
    <button
      type="button"
      aria-label="Prototype"
      title="Prototype"
      :aria-expanded="open"
      :class="['hover:text-base-foreground', open && 'text-base-foreground']"
      @click="open = !open"
    >
      <SlidersHorizontal :size="15" />
    </button>
    <div
      v-if="open"
      class="absolute top-full right-0 z-50 mt-3 flex max-h-[calc(100vh-64px)] w-80 flex-col gap-3 overflow-y-auto rounded-panel bg-card-background p-3 text-base-foreground shadow-popover"
    >
      <p class="px-2 pt-1 text-ui font-medium tracking-wider text-subtle-foreground uppercase">
        Milestone
      </p>
      <div class="flex flex-col" role="radiogroup" aria-label="Milestone">
        <button
          v-for="m in MILESTONES"
          :key="m.value"
          type="button"
          role="radio"
          :aria-checked="proto.milestone === Number(m.value)"
          :class="[
            'flex h-8 items-center justify-between rounded-control px-2 text-left text-ui',
            proto.milestone === Number(m.value)
              ? 'bg-secondary-background-hover text-base-foreground'
              : 'text-muted-foreground hover:bg-secondary-background hover:text-base-foreground'
          ]"
          @click="proto.milestone = Number(m.value)"
        >
          {{ m.label }}
          <Check v-if="proto.milestone === Number(m.value)" :size="14" />
        </button>
      </div>
      <div v-for="g in groups()" :key="g.key" class="flex flex-col gap-1.5 px-2">
        <span class="text-ui text-subtle-foreground">{{ g.label }}</span>
        <div
          class="flex gap-1"
          :class="g.key === 'tune' ? 'items-center' : 'flex-wrap'"
          role="radiogroup"
          :aria-label="g.label"
        >
          <button
            v-for="o in g.options"
            :key="o.value"
            type="button"
            role="radio"
            :aria-checked="g.options.length > 1 && g.model.value === o.value"
            :class="[
              'h-7 rounded-control px-2.5 text-ui',
              g.key === 'tune' && 'min-w-0 flex-1 truncate text-left',
              g.options.length > 1 && g.model.value === o.value
                ? 'bg-secondary-background-hover font-medium text-base-foreground'
                : 'bg-secondary-background text-muted-foreground hover:text-base-foreground'
            ]"
            @click="((g.model.value = o.value), g.key === 'tune' && (open = false))"
          >
            {{ o.label }}
          </button>
          <Seg
            v-if="g.key === 'tune'"
            v-model="look.theme"
            compact
            label="Theme"
            :options="THEMES"
          />
        </div>
      </div>
      <p class="px-2 pb-1 text-ui text-subtle-foreground">⌥1–⌥0 milestone · ⌥N user</p>
    </div>
  </span>
</template>
