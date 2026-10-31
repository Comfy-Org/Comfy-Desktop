<script setup lang="ts">
import DeploymentDetail from '../../pages/modes/DeploymentDetail.vue'
import MarDeploymentDetail from './MarDeploymentDetail.vue'
import { isMariana } from '../proposal'
import type { Deployment } from '../../mock'

/** A deployment's page for the picked proposal: Mar's, or Pablo's untouched. */
const { dep } = defineProps<{ dep: Deployment }>()
</script>

<template>
  <MarDeploymentDetail v-if="isMariana" :dep />
  <DeploymentDetail v-else :dep />
</template>
