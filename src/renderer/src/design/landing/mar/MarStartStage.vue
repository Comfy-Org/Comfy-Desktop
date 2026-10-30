<script setup lang="ts">
import { go } from '../useProto'
import { can } from '../milestones'
import SectionHeader from '../ui/SectionHeader.vue'
import MarStartWhere from './MarStartWhere.vue'
import ExampleShowcase from './userStates/ExampleShowcase.vue'
import { EXAMPLES } from './userStates/examples'

/**
 * First run · Stage (UI Playground › First run): the sections of the
 * returning Home, under the same greeting and prompt (MarHomeV10.vue).
 * Where Recently used goes, examples to run in a click, in the look from
 * UI Playground › First-time examples (ExampleShowcase.vue);
 * where Builds go, where Comfy runs, Cloud or this computer, each saying
 * what it takes.
 */
</script>

<template>
  <section class="mar-rise mt-10" style="--i: 0">
    <SectionHeader
      title="Start from an example"
      :link="can.explore ? 'See all' : undefined"
      @link="go('explore')"
    >
      <template #controls>
        <span
          class="inline-flex h-5 items-center rounded-full bg-secondary-background px-2 text-ui text-muted-foreground"
          >{{ EXAMPLES.length }}</span
        >
      </template>
    </SectionHeader>
    <ExampleShowcase />
  </section>

  <section class="mar-rise mt-10" style="--i: 1">
    <SectionHeader title="Where should Comfy run?" />
    <MarStartWhere />
  </section>
</template>

<style scoped>
/* Entry: each section rises in a beat after the one above. */
.mar-rise {
  animation: mar-rise 700ms cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 60ms + 80ms);
}
@keyframes mar-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-rise {
    animation: none;
  }
}
</style>
