<script setup lang="ts">
import { SECTION_TITLE_CLASS } from '../../lib/sectionTitle'
defineProps<{
  title: string
}>()
</script>

<template>
  <section
    class="performance-test__card flex w-full min-w-0 flex-none flex-col rounded-2xl bg-white/[0.035] px-6 py-[22px] text-[13px] text-text-muted"
  >
    <div class="performance-test__card-head flex min-h-8 min-w-0 items-center">
      <h2 class="m-0 shrink-0" :class="SECTION_TITLE_CLASS">
        {{ title }}
      </h2>
      <slot name="header" />
    </div>
    <div class="performance-test__card-body mt-2.5">
      <slot />
    </div>
  </section>
</template>
