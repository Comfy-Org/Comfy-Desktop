<script setup lang="ts">
import { computed, watch } from 'vue'
import { proto } from '../../useProto'
import MarWorkflowsPage from './MarWorkflowsPage.vue'
import MarAppsPage from './MarAppsPage.vue'
import MarExplore from '../explore/MarExplore.vue'
import { exploreStart } from '../explore/exploreStart'
import { can } from '../../milestones'
import MarAssetsPage from './MarAssetsPage.vue'
import MarBuildsPage from './MarBuildsPage.vue'
import MarProjectsPage from './MarProjectsPage.vue'
import MarProjectPage from './MarProjectPage.vue'
import MarSpacesPage from './MarSpacesPage.vue'
import MarSpacePage from './MarSpacePage.vue'
import MarSettingsPage from './MarSettingsPage.vue'
import MarFavoritesPage from '../MarFavoritesPage.vue'
import MarKeysPage from './MarKeysPage.vue'
import MarDeploymentsPage from '../deploy/MarDeploymentsPage.vue'
import MarLogsPage from '../deploy/MarLogsPage.vue'
import MarToolPage from './MarToolPage.vue'

/**
 * Mar's library pages (Workflows, Apps, Assets, Builds, Projects, Spaces,
 * Settings, and Build's Deployments, Logs and API keys), each with its
 * states. ModePages hands these pages here.
 */
const page = computed<string>(() => proto.page)
// Milestone 3 has no Workflows library or Apps page: the Hub's workflows
// and apps live in Explore. An address that still names them (a shared
// link, view=workflows) lands on Explore's tab for it.
watch(
  page,
  (p) => {
    if (!can.value.explore || can.value.workflows) return
    if (p !== 'workflows' && p !== 'apps') return
    exploreStart.value = p === 'workflows' ? 'templates' : 'apps'
    proto.page = 'explore'
  },
  { immediate: true }
)
// Milestone 2 has no Assets page: generated files are Apps' Generated
// Files tab, as Desktop ships it. An address that names Assets lands there.
watch(
  page,
  (p) => {
    if (p !== 'assets' || !can.value.exploreApps || can.value.explore) return
    exploreStart.value = 'files'
    proto.page = 'apps'
  },
  { immediate: true }
)
</script>

<template>
  <MarWorkflowsPage v-if="page === 'workflows'" />
  <!-- Milestone 2: Apps is where apps are found (Inspiration and All apps);
       from Explore & Learn on, My apps joins them as a third tab. -->
  <MarExplore v-else-if="page === 'apps' && can.exploreApps" as-apps :library="can.explore" />
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
  <MarFavoritesPage v-else-if="page === 'favorites'" />
  <MarToolPage v-else-if="page.startsWith('tool:')" :id="page.slice(5)" :key="page" />
</template>
