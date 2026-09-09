<script setup lang="ts">
// Intentionally NOT a variant of DetailSection.vue, which is slated for
// deletion; coupling the new global-settings UI to it would block that.
import InfoTooltip from '../../components/InfoTooltip.vue'

defineProps<{
  title: string
  tooltip?: string
}>()
</script>

<template>
  <section class="gs-micro-section">
    <h3 class="gs-micro-title">
      <span>{{ title }}</span>
      <InfoTooltip v-if="tooltip" :text="tooltip" />
      <!-- Optional right-aligned header controls (e.g. a shared-source toggle),
           inlined with the title to save a row. -->
      <div v-if="$slots.actions" class="gs-micro-actions">
        <slot name="actions" />
      </div>
    </h3>
    <div class="gs-micro-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.gs-micro-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gs-micro-title {
  display: flex;
  align-items: center;
  margin: 0;
  padding: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

/* Header controls: right-aligned, plain body typography (the uppercase
 * heading style would otherwise leak into slotted labels). */
.gs-micro-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  font-size: 12px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-muted);
}

/* Dim the title text only, not the InfoTooltip: stacking this dim on the
 * tooltip's own 0.6 baseline would nearly hide the `?` icon. */
.gs-micro-title > span {
  opacity: 0.55;
}

.gs-micro-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
