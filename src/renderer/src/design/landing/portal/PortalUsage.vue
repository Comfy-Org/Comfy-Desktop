<script setup lang="ts">
import { computed } from 'vue'
import Card from '../ui/Card.vue'
import Meter from '../ui/Meter.vue'
import PageHeader from '../ui/PageHeader.vue'
import UsageBreakdown from '../parts/space/UsageBreakdown.vue'
import { fmt } from '../parts/env/env'
import { currentSpace, STUDIO } from '../spaces'

/** The space's monthly credits, set by the studio. */
const space = computed(() => currentSpace.value)
</script>

<template>
  <div class="mx-auto w-full max-w-280 px-10 pb-16">
    <PageHeader
      title="Usage"
      :description="`Monthly credits for ${space.name}, set by ${STUDIO.name}.`"
    />
    <Card class="mb-3.5 p-5">
      <p class="text-ui text-muted-foreground">
        <span class="text-title font-semibold text-base-foreground tabular-nums">{{
          fmt(space.budget - space.used)
        }}</span>
        of {{ fmt(space.budget) }} credits left · resets Nov 1
      </p>
      <Meter :value="space.used" :max="space.budget" class="mt-4" />
      <p v-if="space.billing.hardStop" class="mt-3 text-ui text-subtle-foreground">
        Runs pause when credits run out. Ask {{ STUDIO.name }} for more.
      </p>
    </Card>
    <UsageBreakdown :space-id="space.id" />
  </div>
</template>
