<script setup lang="ts" generic="T extends string">
/** Segmented tabs (Mar's pages): radius 10 outside, 7 inside, following
 *  the Corners tweak; an optional count after each label. On a picture
 *  (onMedia) the row is dark glass, light-on-dark in both themes. */
const { options, label, onMedia } = defineProps<{
  options: { value: T; label: string; count?: number; dot?: boolean }[]
  label: string
  onMedia?: boolean
}>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <div class="mar-pseg" :class="onMedia && 'on-media'" role="tablist" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="tab"
      :aria-selected="model === o.value"
      class="mar-pseg-btn"
      @click="model = o.value"
    >
      {{ o.label }}<span v-if="o.count !== undefined" class="mar-pseg-count">{{ o.count }}</span
      ><i v-if="o.dot" class="mar-pseg-dot" aria-label="Update available" />
    </button>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-pseg {
  display: inline-flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 3px;
  border-radius: var(--mar-tab-radius, 10px);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-pseg-btn {
  width: auto;
  height: 26px;
  padding: 0 11px;
  border-radius: var(--mar-tab-item-radius, 7px);
  color: var(--color-muted-foreground);
  font-size: 13px;
  white-space: nowrap;
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-pseg-btn:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-pseg-btn:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}
:root .proto-ui.proto-ui.proto-ui .mar-pseg-btn[aria-selected='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-pseg.on-media {
  background: oklch(0.16 0.004 285 / 0.62);
  backdrop-filter: blur(16px) saturate(1.3);
}
:root .proto-ui.proto-ui.proto-ui .mar-pseg.on-media .mar-pseg-btn {
  color: oklch(1 0 0 / 0.7);
}
:root .proto-ui.proto-ui.proto-ui .mar-pseg.on-media .mar-pseg-btn:hover {
  color: oklch(1 0 0 / 0.95);
}
:root .proto-ui.proto-ui.proto-ui .mar-pseg.on-media .mar-pseg-btn[aria-selected='true'] {
  background: oklch(1 0 0 / 0.16);
  color: oklch(1 0 0);
}
.mar-pseg-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin: 0 0 1px 6px;
  border-radius: 999px;
  background: var(--color-status-warning, #f5b14c);
  vertical-align: middle;
}
.mar-pseg-count {
  margin-left: 6px;
  color: var(--color-subtle-foreground);
  font-variant-numeric: tabular-nums;
}
</style>
