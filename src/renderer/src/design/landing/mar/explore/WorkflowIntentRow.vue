<script setup lang="ts">
import { workflowThumb } from './hubWorkflows'
import type { WorkflowIntent } from './workflowIntents'

const { intents } = defineProps<{ intents: WorkflowIntent[] }>()
const picked = defineModel<string | null>({ required: true })
</script>

<template>
  <section class="mar-wi" aria-labelledby="mar-wi-title">
    <span id="mar-wi-title" class="mar-wi-title">I want to…</span>
    <div class="mar-wi-row">
      <button
        type="button"
        class="mar-wi-chip is-all"
        :aria-pressed="picked === null"
        @click="picked = null"
      >
        All workflows
      </button>
      <button
        v-for="i in intents"
        :key="i.id"
        type="button"
        class="mar-wi-chip"
        :aria-pressed="picked === i.id"
        @click="picked = picked === i.id ? null : i.id"
      >
        <img class="mar-wi-pic" :src="workflowThumb(i.thumbId)" alt="" loading="lazy" />
        <span>{{ i.label }}</span>
      </button>
    </div>
  </section>
</template>

<style>
.mar-wi {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 28px;
}
.mar-wi-title {
  flex-shrink: 0;
  color: var(--color-muted-foreground);
  font-size: 13px;
  line-height: 36px;
}
.mar-wi-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .mar-wi-chip {
  display: inline-flex;
  width: auto;
  height: 36px;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 4px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
  white-space: nowrap;
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-wi-chip.is-all {
  padding: 0 14px;
}
:root .proto-ui.proto-ui.proto-ui .mar-wi-chip:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-wi-chip[aria-pressed='true'] {
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-wi-chip:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
.mar-wi-pic {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 999px;
  object-fit: cover;
}
</style>
