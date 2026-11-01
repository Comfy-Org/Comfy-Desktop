<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Rocket } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Select from '../../ui/Select.vue'
import CloudSignInCta from '../../parts/CloudSignInCta.vue'
import { deployments } from '../../parts/env/env'
import { deployEnv, instances, proto } from '../../useProto'
import { PROJECTS } from '../../mock'
import { SPACES } from '../../spaces'
import MarPage from '../pages/MarPage.vue'
import DeploymentsTable from './DeploymentsTable.vue'

/**
 * Deployments (Mar's proposal): the library page frame every Create page
 * uses (MarPage): title and one primary action, the filters as the
 * toolbar, then the one table.
 */
const firstLocal = computed(() => instances.value.find((i) => i.kind === 'local'))
const project = ref('all')
const space = ref('all')
const projectsOf = (envId: string): string[] =>
  PROJECTS.filter((p) => p.envId === envId).map((p) => p.name)
const list = computed(() =>
  deployments.value.filter(
    (d) =>
      (!proto.projects || project.value === 'all' || projectsOf(d.envId).includes(project.value)) &&
      (!proto.spaces ||
        space.value === 'all' ||
        (space.value === 'none' ? !d.spaceId : d.spaceId === space.value))
  )
)
const PROJECT_OPTIONS = [
  { value: 'all', label: 'All projects' },
  ...PROJECTS.map((p) => ({ value: p.name, label: p.name }))
]
const SPACE_OPTIONS = [
  { value: 'all', label: 'All spaces' },
  ...SPACES.map((s) => ({ value: s.id, label: s.name })),
  { value: 'none', label: 'Not in a space' }
]
const deploy = (): void => {
  if (firstLocal.value) deployEnv(firstLocal.value.id)
}
</script>

<template>
  <MarPage
    title="Deployments"
    skeleton="list"
    :state="proto.signedIn && !deployments.length ? 'empty' : undefined"
    :empty="{
      icon: Rocket,
      title: 'No deployments yet',
      text: 'Pick a build, freeze a version and get an endpoint that scales with traffic.',
      action: 'Deploy a build'
    }"
    @action="deploy"
  >
    <template #actions="{ state }">
      <Button
        v-if="firstLocal && proto.signedIn && (state === 'live' || state === 'loading')"
        variant="primary"
        @click="deploy"
        ><Plus :size="15" />Deployment</Button
      >
    </template>

    <template v-if="proto.signedIn && (proto.projects || proto.spaces)" #toolbar>
      <div class="ml-auto flex items-center gap-2">
        <Select v-if="proto.projects" v-model="project" :options="PROJECT_OPTIONS" class="w-44" />
        <Select v-if="proto.spaces" v-model="space" :options="SPACE_OPTIONS" class="w-40" />
      </div>
    </template>

    <CloudSignInCta
      v-if="!proto.signedIn"
      title="Deploy ComfyUI as an API"
      body="Log in to deploy a build behind an endpoint."
    />
    <DeploymentsTable v-else :list :projects-of="projectsOf" />
  </MarPage>
</template>
