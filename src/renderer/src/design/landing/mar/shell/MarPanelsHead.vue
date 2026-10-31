<script setup lang="ts">
import { ref } from 'vue'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import ComfyWordmark from '../../../../components/icons/ComfyWordmark.vue'
import PanelToggleIcon from './PanelToggleIcon.vue'
import { marNav, marPanelsOn } from './marShell'

/**
 * Floating panels › Sidebar head › Logo + collapse: the sidebar card's
 * head, after Magnific. Open, the Comfy wordmark and the collapse toggle;
 * collapsed to the rail, the Comfy iso over the toggle. In the text
 * colour: neutral first, branding later.
 */
const hover = ref(false)
</script>

<template>
  <div v-if="marPanelsOn" :class="['mar-panels-head', marNav.collapsed && 'is-rail']">
    <span class="mar-panels-brand" aria-label="Comfy">
      <ComfyCLogo v-if="marNav.collapsed" :size="20" />
      <ComfyWordmark v-else />
    </span>
    <button
      type="button"
      class="mar-panels-toggle"
      :aria-label="marNav.collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      :title="marNav.collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      @mouseenter="hover = true"
      @mouseleave="hover = false"
      @click="marNav.collapsed = !marNav.collapsed"
    >
      <PanelToggleIcon :filled="hover" />
    </button>
  </div>
</template>

<style scoped>
.mar-panels-head {
  display: flex;
  height: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  /* Magnific's air above the wordmark. */
  margin-top: 8px;
  margin-bottom: 14px;
  padding-left: 6px;
}
.mar-panels-head.is-rail {
  height: auto;
  flex-direction: column;
  gap: 12px;
  margin-top: 10px;
  padding-left: 0;
}
.mar-panels-brand {
  display: flex;
  color: var(--color-base-foreground);
}
.mar-panels-brand :deep(svg) {
  width: auto;
  height: 22px;
}
.mar-panels-brand :deep(path) {
  fill: currentColor;
}
.mar-panels-toggle {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: var(--mar-tab-item-radius, 7px);
  color: var(--color-muted-foreground);
  transition:
    color 150ms ease,
    background-color 150ms ease;
}
.mar-panels-toggle:hover {
  color: var(--color-base-foreground);
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-panels-toggle:focus-visible {
  outline: 2px solid var(--color-base-foreground);
  outline-offset: 1px;
}
</style>
