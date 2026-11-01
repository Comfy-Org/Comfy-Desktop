<script setup lang="ts">
import { computed } from 'vue'
import { proto } from '../../useProto'
import MarWorkflowsPage from './MarWorkflowsPage.vue'
import MarAppsPage from './MarAppsPage.vue'
import MarAssetsPage from './MarAssetsPage.vue'
import MarBuildsPage from './MarBuildsPage.vue'
import MarProjectsPage from './MarProjectsPage.vue'
import MarProjectPage from './MarProjectPage.vue'
import MarSpacesPage from './MarSpacesPage.vue'
import MarSpacePage from './MarSpacePage.vue'
import MarSettingsPage from './MarSettingsPage.vue'
import MarStateGate from './MarStateGate.vue'
import MarFavoritesPage from '../MarFavoritesPage.vue'
import MarKeysPage from './MarKeysPage.vue'
import MarDeploymentsPage from '../deploy/MarDeploymentsPage.vue'
import MarLogsPage from '../deploy/MarLogsPage.vue'

/**
 * Mar's library pages (Workflows, Apps, Assets, Builds, Projects, Spaces,
 * Settings, and Build's Deployments, Logs and API keys), each with its
 * states. ModePages hands these pages here in Mar's proposal; Pablo's
 * stay as they are in his.
 */
const page = computed<string>(() => proto.page)
</script>

<template>
  <MarWorkflowsPage v-if="page === 'workflows'" />
  <MarAppsPage v-else-if="page === 'apps'" />
  <MarAssetsPage v-else-if="page === 'assets'" />
  <MarBuildsPage v-else-if="page === 'environments' || page === 'instances'" />
  <MarProjectsPage v-else-if="page === 'projects'" />
  <MarProjectPage v-else-if="page.startsWith('project:')" :id="page.slice(8)" :key="page" />
  <MarSpacesPage v-else-if="page === 'spaces'" />
  <MarSpacePage v-else-if="page.startsWith('space:')" :id="page.slice(6)" :key="page" />
  <MarSettingsPage v-else-if="page === 'settings'" />
  <MarDeploymentsPage v-else-if="page === 'deployments'" />
  <MarLogsPage v-else-if="page === 'logs'" />
  <MarKeysPage v-else-if="page === 'keys'" />
  <MarStateGate
    v-else-if="page === 'favorites'"
    title="Favorites"
    error-title="Can't load your favorites"
    error-text="Starred things in Comfy Cloud are out of reach. Starred templates on this computer still open."
  >
    <MarFavoritesPage />
  </MarStateGate>
</template>
