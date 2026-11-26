<script setup lang="ts">
import { computed, ref } from 'vue'
import ComfyWordmark from '../../../../components/icons/ComfyWordmark.vue'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import PanelToggleIcon from './PanelToggleIcon.vue'
import { marNav, marPanelsOn } from './marShell'
import { sidebarMotion } from './sidebarMotion'
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
const desktop = computed(() => sidebarMotion.id === 'desktop')
</script>

<template>
  <div
    v-if="marPanelsOn && desktop"
    class="mar-panels-head is-desktop"
    data-testid="mar-panels-head"
  >
    <Transition name="mar-panels-wordmark">
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
    </Transition>
    <Transition name="mar-panels-face">
      <button
        v-if="marNav.collapsed"
        type="button"
        class="mar-panels-toggle is-expand"
        aria-label="Expand sidebar"
        aria-expanded="false"
        title="Expand sidebar"
        @mouseenter="hover = true"
        @mouseleave="hover = false"
        @click="marNav.collapsed = false"
      >
        <span class="mar-panels-logo-face"><ComfyCLogo :size="20" /></span>
        <span class="mar-panels-expand-face"><PanelToggleIcon :filled="hover" /></span>
      </button>
      <button
        v-else
        type="button"
        class="mar-panels-toggle is-collapse"
        aria-label="Collapse sidebar"
        aria-expanded="true"
        title="Collapse sidebar"
        @mouseenter="hover = true"
        @mouseleave="hover = false"
        @click="marNav.collapsed = true"
      >
        <PanelToggleIcon :filled="hover" />
      </button>
    </Transition>
  </div>
  <div v-else-if="marPanelsOn" :class="['mar-panels-head', marNav.collapsed && 'is-rail']">
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
.mar-panels-head.is-desktop {
  position: relative;
  display: block;
  width: 100%;
  padding-left: 0;
}
.is-desktop .mar-panels-brand {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 6px;
  height: 26px;
  margin: auto 0;
  transform-origin: left center;
}
.is-desktop .mar-panels-toggle {
  position: absolute;
  top: 0;
  bottom: 0;
  margin: auto 0;
}
.is-desktop .mar-panels-toggle.is-collapse {
  right: 0;
}
.is-desktop .mar-panels-toggle.is-expand {
  left: 5px;
}
.mar-panels-logo-face,
.mar-panels-expand-face {
  grid-area: 1 / 1;
  display: grid;
  place-items: center;
  transition:
    opacity 180ms cubic-bezier(0, 0, 0.2, 1),
    scale 180ms cubic-bezier(0, 0, 0.2, 1);
}
.mar-panels-logo-face {
  color: var(--color-base-foreground);
}
.mar-panels-expand-face {
  opacity: 0;
  scale: 0.9;
}
.is-expand:hover .mar-panels-logo-face,
.is-expand:focus-visible .mar-panels-logo-face {
  opacity: 0;
  scale: 0.9;
}
.is-expand:hover .mar-panels-expand-face,
.is-expand:focus-visible .mar-panels-expand-face {
  opacity: 1;
  scale: 1;
}
.mar-panels-wordmark-enter-active {
  transition:
    opacity 200ms cubic-bezier(0, 0, 0.2, 1) 120ms,
    scale 200ms cubic-bezier(0, 0, 0.2, 1) 120ms;
}
.mar-panels-wordmark-leave-active {
  transition:
    opacity 150ms cubic-bezier(0, 0, 0.2, 1),
    scale 150ms cubic-bezier(0, 0, 0.2, 1);
}
.mar-panels-wordmark-enter-from,
.mar-panels-wordmark-leave-to {
  opacity: 0;
  scale: 0.95;
}
.mar-panels-face-enter-active {
  transition:
    opacity 180ms cubic-bezier(0, 0, 0.2, 1),
    scale 180ms cubic-bezier(0, 0, 0.2, 1);
}
.mar-panels-face-leave-active {
  transition:
    opacity 150ms cubic-bezier(0, 0, 0.2, 1),
    scale 150ms cubic-bezier(0, 0, 0.2, 1);
}
.mar-panels-face-enter-from,
.mar-panels-face-leave-to {
  opacity: 0;
  scale: 0.9;
}
@media (prefers-reduced-motion: reduce) {
  .mar-panels-wordmark-enter-from,
  .mar-panels-wordmark-leave-to,
  .mar-panels-face-enter-from,
  .mar-panels-face-leave-to,
  .mar-panels-expand-face,
  .is-expand:hover .mar-panels-logo-face,
  .is-expand:focus-visible .mar-panels-logo-face {
    scale: 1;
  }
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
