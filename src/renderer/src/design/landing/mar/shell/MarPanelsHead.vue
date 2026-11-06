<script setup lang="ts">
import { ref } from 'vue'
import ComfyWordmark from '../../../../components/icons/ComfyWordmark.vue'
import PanelToggleIcon from './PanelToggleIcon.vue'
import { marNav, marPanelsOn } from './marShell'
import { goModeHome } from '../modes/home'

/**
 * Floating panels: the sidebar card's
 * head, after Magnific. Open, the Comfy wordmark and the collapse toggle;
 * collapsed to the rail, only the toggle, at the same height, so opening
 * and closing never moves it up or down. In the text colour: neutral
 * first, branding later. The mark goes Home, in the last Create or Build
 * mode.
 */
const hover = ref(false)
</script>

<template>
  <div v-if="marPanelsOn" :class="['mar-panels-head', marNav.collapsed && 'is-rail']">
    <button
      v-if="!marNav.collapsed"
      type="button"
      class="mar-panels-brand"
      aria-label="Home"
      title="Home"
      @click="goModeHome()"
    >
      <ComfyWordmark />
    </button>
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
  justify-content: center;
  padding-left: 0;
}
.mar-panels-brand {
  display: flex;
  padding: 2px;
  border-radius: var(--mar-tab-item-radius, 7px);
  color: var(--color-base-foreground);
  cursor: pointer;
}
.mar-panels-brand:focus-visible {
  outline: 2px solid var(--color-base-foreground);
  outline-offset: 2px;
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
