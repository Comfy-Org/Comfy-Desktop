<script setup lang="ts">
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'
import { marShell, marShellOn } from './marShell'

/** Opens and closes Mar's floating sidebar. */
</script>

<template>
  <button
    v-if="marShellOn"
    type="button"
    :class="['mar-sidebar-toggle', marShell.open ? 'is-open' : 'is-closed']"
    :aria-label="marShell.open ? 'Close sidebar' : 'Open sidebar'"
    :title="marShell.open ? 'Close sidebar' : 'Open sidebar'"
    @click="marShell.open = !marShell.open"
  >
    <component :is="marShell.open ? PanelLeftClose : PanelLeftOpen" :size="16" />
  </button>
</template>

<style scoped>
.mar-sidebar-toggle {
  position: absolute;
  top: 18px;
  z-index: 30;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--color-muted-foreground);
  transition:
    left 320ms cubic-bezier(0.645, 0.045, 0.355, 1),
    background-color 150ms ease;
}
.mar-sidebar-toggle:hover {
  color: var(--color-foreground);
  background: rgb(255 255 255 / 0.07);
}
.mar-sidebar-toggle.is-open {
  /* Top right of the open sidebar (8px inset + 236px wide). */
  left: 206px;
}
.mar-sidebar-toggle.is-closed {
  left: 14px;
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(40px);
}
@media (prefers-reduced-motion: reduce) {
  .mar-sidebar-toggle {
    transition: background-color 150ms ease;
  }
}
</style>
