<script setup lang="ts">
import { computed, ref } from 'vue'
import { ScrollText } from 'lucide-vue-next'
import Select from '../../ui/Select.vue'
import { go } from '../../useProto'
import { deployments } from '../../parts/env/env'
import MarPage from '../pages/MarPage.vue'
import DeploymentRequests from './DeploymentRequests.vue'

const filter = ref('all')
const shown = computed(() =>
  deployments.value.filter((d) => filter.value === 'all' || d.name === filter.value)
)
const OPTIONS = computed(() => [
  { value: 'all', label: 'All deployments' },
  ...deployments.value.map((d) => ({ value: d.name, label: d.name }))
])
</script>

<template>
  <MarPage
    title="Logs"
    skeleton="list"
    :state="!deployments.length ? 'empty' : undefined"
    :empty="{
      icon: ScrollText,
      title: 'No requests yet',
      text: 'Every call to a deployment shows up here, newest first.',
      action: 'See deployments'
    }"
    @action="go('deployments')"
  >
    <template #toolbar>
      <div class="ml-auto flex items-center gap-2">
        <Select v-model="filter" :options="OPTIONS" class="w-44" />
      </div>
    </template>

    <DeploymentRequests :deps="shown" />
  </MarPage>
</template>
