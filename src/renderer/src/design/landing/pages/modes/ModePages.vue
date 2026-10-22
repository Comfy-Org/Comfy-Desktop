<script setup lang="ts">
import { computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import PageHeader from '../../ui/PageHeader.vue'
import AgentPage from '../AgentPage.vue'
import FirstEmpty from '../../parts/FirstEmpty.vue'
import AppsPage from '../AppsPage.vue'
import ProjectsOverview from '../ProjectsOverview.vue'
import AssetsPage from '../AssetsPage.vue'
import ExplorePage from '../ExplorePage.vue'
import TutorialsPage from '../TutorialsPage.vue'
import ApiKeysPage from '../env/ApiKeysPage.vue'
import ProjectWorkflows from '../project/ProjectWorkflows.vue'
import AdminPages from './AdminPages.vue'
import BuildOverview from './BuildOverview.vue'
import BuildStart from './BuildStart.vue'
import CreateHome from './CreateHome.vue'
import DeploymentDetail from './DeploymentDetail.vue'
import DeploymentsPage from './DeploymentsPage.vue'
import EnvironmentDetail from './EnvironmentDetail.vue'
import EnvironmentsList from './EnvironmentsList.vue'
import LogsPage from './LogsPage.vue'
import RouterPage from './RouterPage.vue'
import WorkflowsPage from '../WorkflowsPage.vue'
import SpaceAdmin from '../spaces/SpaceAdmin.vue'
import SpacesList from '../spaces/SpacesList.vue'
import { spaceById } from '../../spaces'
import { deploymentById, envById } from '../../parts/env/env'
import { proto, toast } from '../../useProto'
import { can } from '../../milestones'

/** Router for the Create / Build IA. */
const envId = computed(() => (proto.page.startsWith('environment:') ? proto.page.slice(12) : ''))
const depId = computed(() => (proto.page.startsWith('deployment:') ? proto.page.slice(11) : ''))
const env = computed(() => (envId.value ? envById(envId.value) : undefined))
const dep = computed(() => (depId.value ? deploymentById(depId.value) : undefined))
const projectId = computed(() => (proto.page.startsWith('project:') ? proto.page.slice(8) : ''))
const space = computed(() =>
  proto.page.startsWith('space:') ? spaceById(proto.page.slice(6)) : undefined
)
const libraryKind = computed(() => proto.page as 'workflows' | 'apps' | 'assets')
const ADMIN = ['usage', 'billing', 'limits', 'people', 'provider-keys']
</script>

<template>
  <CreateHome v-if="proto.page === 'overview' && can.home" />
  <!-- First run: libraries are empty, so show what will live there. -->
  <div
    v-else-if="proto.fresh && ['workflows', 'apps', 'assets'].includes(proto.page)"
    class="mx-auto w-full max-w-300 px-10"
  >
    <FirstEmpty :kind="libraryKind" />
  </div>
  <div v-else-if="proto.page === 'workflows'" class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader
      title="Workflows"
      description="Every workflow, on this computer and in the cloud. Each opens in its build."
    >
      <template #actions
        ><Button variant="primary" size="lg" @click="toast('New workflow')"
          ><Plus :size="15" />Workflow</Button
        ></template
      >
    </PageHeader>
    <ProjectWorkflows />
  </div>
  <AppsPage v-else-if="proto.page === 'apps'" />
  <ProjectsOverview v-else-if="proto.page === 'projects' && proto.projects" />
  <AgentPage v-else-if="proto.page === 'agent'" />
  <AssetsPage v-else-if="proto.page === 'assets'" />
  <EnvironmentsList v-else-if="proto.page === 'environments' || proto.page === 'instances'" />
  <EnvironmentDetail v-else-if="env" :key="env.id" :env />
  <WorkflowsPage v-else-if="projectId && proto.projects" :key="projectId" :project="projectId" />
  <SpacesList v-else-if="proto.page === 'spaces' && proto.spaces" />
  <SpaceAdmin v-else-if="space && proto.spaces" :key="space.id" :space />
  <ExplorePage v-else-if="proto.page === 'explore'" />
  <TutorialsPage v-else-if="proto.page === 'tutorials'" />
  <BuildStart v-else-if="proto.page === 'build-overview' && proto.fresh" />
  <BuildOverview v-else-if="proto.page === 'build-overview'" />
  <DeploymentsPage v-else-if="proto.page === 'deployments'" />
  <DeploymentDetail v-else-if="dep" :key="dep.id" :dep />
  <RouterPage v-else-if="proto.page === 'router'" />
  <LogsPage v-else-if="proto.page === 'logs'" />
  <ApiKeysPage v-else-if="proto.page === 'keys'" />
  <AdminPages v-else-if="ADMIN.includes(proto.page)" />
  <CreateHome v-else-if="can.home" />
  <EnvironmentsList v-else />
</template>
