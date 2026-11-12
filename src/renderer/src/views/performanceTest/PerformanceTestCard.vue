<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <section
    class="performance-test__card flex w-full min-w-0 flex-none flex-col rounded-2xl bg-white/[0.035] px-6 py-[22px] text-[13px] text-text-muted"
  >
    <div class="performance-test__card-head flex min-h-8 min-w-0 items-center">
      <h2
        class="m-0 shrink-0 text-[11px] font-semibold tracking-[0.04em] text-subtle-foreground uppercase"
      >
        {{ title }}
      </h2>
      <slot name="header" />
    </div>
    <div class="performance-test__card-body mt-2.5">
      <slot />
    </div>
  </section>
</template>
