<script setup lang="ts">
import MarBuildsPage from '../../MarBuildsPage.vue'
import MarKeysPage from '../../MarKeysPage.vue'
import MarDeploymentsPage from '../../../deploy/MarDeploymentsPage.vue'
import OptionC from './OptionC.vue'
import { computeTab } from './variant'
</script>

<template>
  <MarDeploymentsPage v-if="computeTab === 'deployments'" />
  <OptionC v-else-if="computeTab === 'usage'" />
  <MarKeysPage v-else-if="computeTab === 'keys'" />
  <MarBuildsPage v-else />
</template>
