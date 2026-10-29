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
  <section class="gs-micro-section flex flex-col gap-2">
    <h3
      class="gs-micro-title m-0 flex items-center px-0 pt-0 pb-1 text-[11px] font-semibold tracking-[0.04em] text-text-muted uppercase [&>span]:opacity-55"
    >
      <span>{{ title }}</span>
      <InfoTooltip v-if="tooltip" :text="tooltip" />
      <!-- Optional right-aligned header controls (e.g. a shared-source toggle),
           inlined with the title to save a row. -->
      <div
        v-if="$slots.actions"
        class="gs-micro-actions ml-auto inline-flex items-center gap-2 text-[12px] font-normal tracking-normal text-text-muted normal-case"
      >
        <slot name="actions" />
      </div>
    </h3>
    <div class="gs-micro-body flex flex-col gap-2">
      <slot />
    </div>
  </section>
</template>
