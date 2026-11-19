<script setup lang="ts">
import { ref, type Component } from 'vue'
import { LoaderCircle } from 'lucide-vue-next'
import StatusDot from '../../ui/StatusDot.vue'
import MarItemMenu from '../pages/MarItemMenu.vue'
import type { MenuLine } from '../pages/menu'

/**
 * One build on the Home (MarBuildsRow.vue, and the install card drawn as
 * one, setup/HomeInstall.vue): the machine drawn, where it stands, its
 * name, one line. One height in every state. In progress it looks like any
 * other tile: the status line with its percent, the bar along the bottom
 * edge, a click opens its logs, the actions in ⋯. The ⋯ fades in on hover
 * and focus at the right; a right-click opens the same menu.
 */
const {
  hue,
  name,
  meta,
  note,
  hint,
  status,
  lines = [],
  percent = null,
  openable = true
} = defineProps<{
  hue: number
  name: string
  meta: string
  /** A grey note after the line that stays when it truncates (Update). */
  note?: string
  /** What a click does, on hover (Click to start / open / view logs). */
  hint?: string
  status: { label: string; live?: boolean; busy?: boolean; bad?: boolean; icon?: Component }
  lines?: MenuLine[]
  percent?: number | null
  openable?: boolean
}>()
const emit = defineEmits<{ open: [] }>()
const menuOpen = ref(false)
function context(e: MouseEvent): void {
  if (!lines.length) return
  e.preventDefault()
  menuOpen.value = true
}
</script>

<template>
  <div
    class="mbr-card mbr-tile"
    :class="[menuOpen && 'is-menu', lines.length && 'has-menu', status.busy && 'is-busy']"
    :style="{ '--h': hue }"
    @contextmenu="context"
  >
    <button
      v-if="openable"
      type="button"
      class="mbr-open"
      :aria-label="`${name}, ${status.label}`"
      :title="hint || undefined"
      @click="emit('open')"
    ></button>
    <span class="mbr-device"><slot name="device" /></span>
    <span class="mbr-text grid min-w-0 flex-1">
      <span class="mss-machine-kicker" :class="status.bad && 'is-bad'"
        ><LoaderCircle v-if="status.busy" :size="12" class="mbr-spin" /><component
          :is="status.icon"
          v-else-if="status.icon"
          :size="12"
        /><StatusDot v-else-if="status.live" status="running" /><span class="truncate">{{
          status.label
        }}</span></span
      >
      <span class="mbr-name">{{ name }}</span>
      <span class="mbr-meta flex min-w-0 tabular-nums"
        ><span class="min-w-0 truncate">{{ meta }}</span
        ><span v-if="note" class="shrink-0 whitespace-pre"
          >{{ meta ? ' · ' : '' }}{{ note }}</span
        ></span
      >
    </span>
    <span v-if="$slots.actions" class="mbr-actions"><slot name="actions" /></span>
    <span v-if="lines.length" class="mbr-more">
      <MarItemMenu v-model:open="menuOpen" :lines label="Build actions" />
    </span>
    <span v-if="percent !== null" class="mbr-bar" aria-hidden="true"
      ><span :style="{ transform: `scaleX(${percent / 100})` }"></span
    ></span>
  </div>
</template>
