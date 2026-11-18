<script setup lang="ts">
import { Info } from 'lucide-vue-next'
import Tooltip from '../../ui/Tooltip.vue'

/**
 * One section of a build tab that reads top-down (Comfy-Desktop#2217):
 * the uppercase title on top, its long description in the title's info
 * tooltip, its toggle on the same line at the right, then the rows full
 * width in a fill a step lighter, radius 14, no lines. Folders and
 * Startup arguments use it; it replaces the side title column.
 */
const { title, info } = defineProps<{ title: string; info?: string }>()
</script>

<template>
  <section class="mar-bb">
    <header class="mar-bb-head">
      <h3 class="mar-bb-title">{{ title }}</h3>
      <Tooltip v-if="info" :content="info">
        <button type="button" class="mar-bb-info" :aria-label="`About ${title}`">
          <Info :size="13" />
        </button>
      </Tooltip>
      <span v-if="$slots.actions" class="mar-bb-actions"><slot name="actions" /></span>
    </header>
    <div class="mar-bb-body"><slot /></div>
  </section>
</template>

<style>
.mar-bb {
  display: flex;
  max-width: 48rem;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}
.mar-bb + .mar-bb {
  margin-top: 28px;
}
.mar-bb-head {
  display: flex;
  min-height: 24px;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.mar-bb-title {
  margin: 0;
  color: var(--color-muted-foreground);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  line-height: 16px;
  text-transform: uppercase;
}
:root .proto-ui.proto-ui.proto-ui .mar-bb-info {
  display: inline-flex;
  padding: 2px;
  border-radius: 6px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-bb-info:hover {
  color: var(--color-base-foreground);
}
.mar-bb-actions {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  margin-left: auto;
}
/* The rows: a fill a step lighter, no stroke; rows apart by space. */
.mar-bb-body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
.mar-bb-body > * {
  border-radius: 10px;
}
</style>
