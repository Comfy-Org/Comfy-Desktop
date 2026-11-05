<script setup lang="ts">
import { computed } from 'vue'
import AppDetail from '../AppDetail.vue'
import { libApp } from '../../appFlow'
import AdminPages from './AdminPages.vue'
import MarAgent from '../../mar/agent/MarAgent.vue'
import MarBuildOverview from '../../mar/build/MarBuildOverview.vue'
import MarBuildPage from '../../mar/build/MarBuildPage.vue'
import MarBuildStart from '../../mar/build/MarBuildStart.vue'
import MarModelsPage from '../../mar/build/MarModelsPage.vue'
import MarDeploymentDetail from '../../mar/deploy/MarDeploymentDetail.vue'
import MarExplore from '../../mar/explore/MarExplore.vue'
import MarHomeV10 from '../../mar/MarHomeV10.vue'
import MarLearn from '../../mar/learn/MarLearn.vue'
import MarBuildsPage from '../../mar/pages/MarBuildsPage.vue'
import MarPages from '../../mar/pages/MarPages.vue'
import { marOwns } from '../../mar/pages/owns'
import { deploymentById, envById } from '../../parts/env/env'
import { m1BuildById } from '../../mar/build/m1Builds'
import { isNewUser, proto } from '../../useProto'
import { can } from '../../milestones'

/** Router for the Create / Build IA. */
const envId = computed(() => (proto.page.startsWith('environment:') ? proto.page.slice(12) : ''))
const depId = computed(() => (proto.page.startsWith('deployment:') ? proto.page.slice(11) : ''))
const env = computed(() =>
  envId.value
    ? (envById(envId.value) ?? (!can.value.home ? m1BuildById(envId.value) : undefined))
    : undefined
)
const dep = computed(() => (depId.value ? deploymentById(depId.value) : undefined))
const app = computed(() =>
  proto.page.startsWith('app:') ? libApp(proto.page.slice(4)) : undefined
)
const ADMIN = ['usage', 'billing', 'limits', 'people', 'provider-keys']
</script>

<template>
  <MarPages v-if="marOwns(proto.page)" />
  <MarHomeV10 v-else-if="proto.page === 'overview' && can.home" />
  <AppDetail v-else-if="app && can.exploreApps" :id="app.id" :key="app.id" />
  <MarAgent v-else-if="proto.page === 'agent'" />
  <MarBuildPage v-else-if="env" :key="env.id" :env />
  <MarExplore v-else-if="proto.page === 'explore'" />
  <MarLearn v-else-if="proto.page === 'tutorials'" />
  <MarBuildStart v-else-if="proto.page === 'build-overview' && isNewUser" />
  <MarBuildOverview v-else-if="proto.page === 'build-overview'" />
  <MarDeploymentDetail v-else-if="dep" :key="dep.id" :dep />
  <MarModelsPage v-else-if="proto.page === 'router'" />
  <AdminPages v-else-if="ADMIN.includes(proto.page)" />
  <MarHomeV10 v-else-if="can.home" />
  <MarBuildsPage v-else />
</template>
