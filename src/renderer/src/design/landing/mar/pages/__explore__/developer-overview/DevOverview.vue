<script setup lang="ts">
import MarBuildsPage from '../../MarBuildsPage.vue'
import MarKeysPage from '../../MarKeysPage.vue'
import MarDeploymentsPage from '../../../deploy/MarDeploymentsPage.vue'
import OptionA from './OptionA.vue'
import OptionC from './OptionC.vue'
import OptionBar from './OptionBar.vue'
import { computeNav, computeTab } from './variant'
</script>

<template>
  <template v-if="computeNav">
    <MarDeploymentsPage v-if="computeTab === 'deployments'" />
    <OptionC v-else-if="computeTab === 'usage'" />
    <MarKeysPage v-else-if="computeTab === 'keys'" />
    <MarBuildsPage v-else />
  </template>
  <template v-else>
    <OptionA />
    <OptionBar />
  </template>
</template>
