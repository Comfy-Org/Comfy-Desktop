<script setup lang="ts">
/**
 * 15 · Keycap hint (Figma 121:2697, "Keycap hint"): a key, or a few keys
 * in a row, shown next to the action they trigger.
 */
defineProps<{ keys: string[] }>()
</script>

<template>
  <span class="p15-keys" aria-hidden="true">
    <kbd v-for="(k, i) in keys" :key="i" class="p15-key">{{ k }}</kbd>
  </span>
</template>

<style scoped>
.p15-keys {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 3px;
}
.p15-key {
  display: inline-flex;
  min-width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border-radius: 5px;
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-muted-foreground);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
}
</style>
