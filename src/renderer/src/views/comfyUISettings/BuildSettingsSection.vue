<script setup lang="ts">
defineProps<{
  title: string
  hint?: string
}>()
</script>

<template>
  <section
    class="build-settings-section grid grid-cols-1 gap-3 @2xl/build-settings:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @2xl/build-settings:gap-x-12"
  >
    <header class="build-settings-head flex min-w-0 flex-col gap-3 @2xl/build-settings:pt-3">
      <div class="flex min-w-0 flex-col gap-1.5">
        <h3
          class="build-settings-title m-0 text-[11px] leading-[16px] font-semibold tracking-[0.06em] text-text-muted uppercase"
        >
          {{ title }}
        </h3>
        <p v-if="hint" class="build-settings-hint m-0 text-[13px] leading-[1.5] text-text-muted">
          {{ hint }}
        </p>
      </div>
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
