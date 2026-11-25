<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import Button from '../../../../ui/Button.vue'
import { deployments } from '../../../../parts/env/env'
import { instances, toast } from '../../../../useProto'
import { projects } from '../../projectsStore'
import MarPage from '../../MarPage.vue'
import MarSeg from '../../MarSeg.vue'
import MarSearchField from '../../MarSearchField.vue'
import MarBuildsPage from '../../MarBuildsPage.vue'
import DeploymentsTable from '../../../deploy/DeploymentsTable.vue'

type Tab = 'builds' | 'deployments'
const tab = ref<Tab>('deployments')
const TABS = computed(() => [
  { value: 'builds' as const, label: 'Builds', count: instances.value.length },
  { value: 'deployments' as const, label: 'Deployments', count: deployments.value.length }
])
type State = 'all' | 'running' | 'failing'
const state = ref<State>('all')
const STATES = computed(() => [
  { value: 'all' as const, label: 'All', count: deployments.value.length },
  {
    value: 'running' as const,
    label: 'Running',
    count: deployments.value.filter((d) => d.status === 'running').length
  },
  {
    value: 'failing' as const,
    label: 'Errors over 1%',
    count: deployments.value.filter((d) => d.errorRate > 1).length
  }
])
const query = ref('')
const list = computed(() =>
  deployments.value.filter(
    (d) =>
      (state.value === 'all' ||
        (state.value === 'running' ? d.status === 'running' : d.errorRate > 1)) &&
      d.name.includes(query.value.trim().toLowerCase())
  )
)
const projectsOf = (envId: string): string[] =>
  projects.items.filter((p) => p.envId === envId && !p.archived).map((p) => p.name)
</script>

<template>
  <MarPage title="Builds" skeleton="list" state="live">
    <template #actions>
      <Button v-if="tab === 'builds'" variant="primary" @click="toast('New build')"
        ><Plus :size="15" />New build</Button
      >
      <Button v-else variant="primary" @click="toast('Pick a build to deploy')"
        ><Plus :size="15" />Deployment</Button
      >
    </template>
    <template #tabs>
      <div class="mb-5">
        <MarSeg v-model="tab" :options="TABS" label="Builds" />
      </div>
    </template>
    <template v-if="tab === 'deployments'" #toolbar>
      <MarSeg v-model="state" :options="STATES" label="State" />
      <div class="ml-auto flex items-center gap-2">
        <MarSearchField v-model="query" placeholder="Search deployments" />
      </div>
    </template>

    <div v-if="tab === 'builds'" class="dev-b-inner">
      <MarBuildsPage />
    </div>
    <DeploymentsTable v-else :list :projects-of="projectsOf" />
  </MarPage>
</template>

<style scoped>
.dev-b-inner :deep(.mar-page-head) {
  display: none;
}
.dev-b-inner :deep(.mar-page) {
  max-width: none;
  padding: 0;
}
</style>
