<script setup lang="ts">
import InfoTooltip from '../../components/InfoTooltip.vue'

defineProps<{
  title: string
  hint?: string
}>()
</script>

<template>
  <section class="build-settings-section flex min-w-0 max-w-3xl flex-col gap-2">
    <header class="build-settings-head flex min-h-7 min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      <h3
        class="build-settings-title m-0 inline-flex min-w-0 items-center text-[11px] leading-[16px] font-semibold tracking-[0.06em] text-text-muted uppercase"
      >
        <span>{{ title }}</span>
        <InfoTooltip v-if="hint" :text="hint" />
      </h3>
      <div
        v-if="$slots.actions"
        class="build-settings-actions ml-auto flex min-w-0 items-center gap-2 text-[13px] text-text-muted"
      >
        <slot name="actions" />
      </div>
    </header>
    <div class="build-settings-body flex min-w-0 flex-col gap-2">
      <slot />
    </div>
  </section>
</template>
