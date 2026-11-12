<script setup lang="ts">
import type { ProtoInstance } from '../../mock'
import BuildAbout from './BuildAbout.vue'
import BuildUpdate from './BuildUpdate.vue'
import BuildUpdateSummary from './BuildUpdateSummary.vue'

/**
 * A build's Overview, from Milestone 3: About and Update in one tab, so
 * the versions show once. A build on this computer leads with whether
 * it's up to date, then its facts, then PyTorch. Cloud and Remote show
 * their facts.
 */
const { env, own } = defineProps<{ env: ProtoInstance; own: boolean }>()
</script>

<template>
  <BuildUpdateSummary v-if="own" :env />
  <BuildAbout :env :combined="own" />
  <BuildUpdate v-if="own" :env torch-only />
</template>
