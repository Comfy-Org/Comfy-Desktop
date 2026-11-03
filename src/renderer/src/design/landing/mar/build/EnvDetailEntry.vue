<script setup lang="ts">
import EnvironmentDetail from '../../pages/modes/EnvironmentDetail.vue'
import type { ProtoInstance } from '../../mock'
import MarBuildPage from './MarBuildPage.vue'
import { buildNavProposed } from './buildNav'

/** A build's page. UI Playground › Build navigation › Proposed draws Mar's
 *  (MarBuildPage.vue); Current is Pablo's. */
const { env } = defineProps<{ env: ProtoInstance }>()
</script>

<template>
  <MarBuildPage v-if="buildNavProposed" :key="env.id" :env />
  <EnvironmentDetail v-else :key="env.id" :env />
</template>
