<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { Check, SlidersHorizontal } from 'lucide-vue-next'
import SegmentedControl from './ui/SegmentedControl.vue'
import { proto, toggleHome } from './useProto'
import { can, MILESTONES } from './milestones'
import { prototypeGroups } from './prototypeOptions'

/** Prototype controls, bottom-left (the browser preview; in the app they're
 *  the title bar's Prototype menu, so only the shortcuts stay here): the
 *  milestone, then the scenario. ⌥1-⌥0 milestone · ⌥N new user ·
 *  ⌘⇧H home ⇄ build (Milestone 7). */
const { inTitleBar } = defineProps<{ inTitleBar: boolean }>()

const scenario = (): typeof prototypeGroups.value => prototypeGroups.value.slice(1)

function onKey(e: KeyboardEvent): void {
  // ⌘⇧H: Home ⇄ the build you were in.
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyH' && can.value.oneWindow) {
    e.preventDefault()
    toggleHome()
    return
  }
  if (!e.altKey) return
  // ⌥1 is Milestone 0, … ⌥0 is Milestone 9.
  const digit = /^Digit(\d)$/.exec(e.code)?.[1]
  if (digit) proto.milestone = (Number(digit) + 9) % 10
  else if (e.code === 'KeyN' && can.value.home) proto.fresh = !proto.fresh
  else return
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- Small button; hovering opens the panel above it. -->
  <div
    v-if="!inTitleBar"
    role="toolbar"
    aria-label="Prototype controls"
    :class="['fixed bottom-2.5 z-40 flex items-end gap-1.5', can.builds ? 'left-67' : 'left-4']"
  >
    <div class="group/proto relative">
      <div
        class="invisible absolute bottom-full left-0 pb-2 opacity-0 transition-[opacity,visibility] duration-150 group-focus-within/proto:visible group-focus-within/proto:opacity-100 group-hover/proto:visible group-hover/proto:opacity-100"
      >
        <div
          class="flex w-80 flex-col gap-3 rounded-panel border border-border-default bg-card-background/95 p-4 shadow-popover backdrop-blur-md"
        >
          <p class="text-ui font-medium tracking-wider text-subtle-foreground uppercase">
            Milestone
          </p>
          <div class="-mx-1 flex flex-col" role="radiogroup" aria-label="Milestone">
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
          <div v-for="g in scenario()" :key="g.key" class="flex items-center justify-between gap-3">
            <span class="text-ui text-muted-foreground">{{ g.label }}</span>
            <SegmentedControl
              v-model="g.model.value"
              variant="contained"
              size="sm"
              :options="g.options"
            />
          </div>
          <p class="text-ui text-subtle-foreground">⌥1–⌥0 milestone · ⌥N user</p>
        </div>
      </div>
      <button
        type="button"
        class="flex h-7 items-center gap-1.5 rounded-full border border-border-default bg-card-background/85 px-2.5 text-ui text-muted-foreground opacity-50 backdrop-blur-md transition-opacity outline-none group-hover/proto:opacity-100 focus-visible:opacity-100"
      >
        <SlidersHorizontal :size="12" />Prototype
      </button>
    </div>
  </div>
</template>
