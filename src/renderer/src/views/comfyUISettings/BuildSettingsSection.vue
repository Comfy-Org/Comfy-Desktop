<script setup lang="ts">
import InfoTooltip from '../../components/InfoTooltip.vue'

defineProps<{
  title: string
  tooltip?: string
}>()
</script>

<template>
  <section
    class="build-settings-section grid grid-cols-1 gap-3 @2xl/build-settings:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @2xl/build-settings:gap-x-12"
  >
    <header class="build-settings-head flex min-w-0 flex-col gap-3 @2xl/build-settings:pt-1">
      <h3
        class="build-settings-title m-0 flex items-center gap-1 text-[13px] leading-[18px] font-semibold text-neutral-100"
      >
        <span>{{ title }}</span>
        <InfoTooltip v-if="tooltip" :text="tooltip" />
      </h3>
      <div
        v-if="$slots.actions"
        class="build-settings-actions flex min-w-0 flex-col gap-2 text-[13px] text-text-muted"
      >
        <slot name="actions" />
      </div>
    </header>
    <div class="build-settings-body flex min-w-0 max-w-xl flex-col gap-2">
      <slot />
    </div>
  </section>
</template>
