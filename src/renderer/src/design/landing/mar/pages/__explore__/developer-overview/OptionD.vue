<script setup lang="ts">
import { computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import Button from '../../../../ui/Button.vue'
import SectionHeader from '../../../../ui/SectionHeader.vue'
import InstanceGlyph from '../../../../parts/InstanceGlyph.vue'
import { deployments, deploymentsOf, versionsOf } from '../../../../parts/env/env'
import { instances, toast } from '../../../../useProto'
import { openBuild } from '../../../build/buildTab'
import { projects } from '../../projectsStore'
import MarPage from '../../MarPage.vue'
import DeploymentsTable from '../../../deploy/DeploymentsTable.vue'

const builds = computed(() =>
  instances.value.filter(
    (i) => i.kind !== 'local' || deploymentsOf(i.id).length || versionsOf(i).length
  )
)
const projectsOf = (envId: string): string[] =>
  projects.items.filter((p) => p.envId === envId && !p.archived).map((p) => p.name)
</script>

<template>
  <MarPage title="Deploy" skeleton="list" state="live">
    <template #actions>
      <Button @click="toast('New build')"><Plus :size="15" />Build</Button>
      <Button variant="primary" @click="toast('Pick a build to deploy')"
        ><Plus :size="15" />Deployment</Button
      >
    </template>

    <SectionHeader title="Builds" />
    <div
      class="mar-table mb-10"
      role="table"
      aria-label="Builds"
      style="--mar-grid: minmax(0, 1.4fr) minmax(0, 1fr) 112px 112px 120px"
    >
      <div class="mar-table-head" role="row">
        <span role="columnheader">Build</span>
        <span role="columnheader">Latest version</span>
        <span role="columnheader" class="is-num">Deployments</span>
        <span role="columnheader" class="is-num">Projects</span>
        <span role="columnheader" class="is-end">Last used</span>
      </div>
      <div
        v-for="b in builds"
        :key="b.id"
        class="mar-table-row"
        role="row"
        tabindex="0"
        @click="openBuild(b.id)"
        @keydown.enter="openBuild(b.id)"
      >
        <span class="mar-table-name" role="cell">
          <span class="flex min-w-0 items-center gap-2"
            ><InstanceGlyph :inst="b" size="xs" /><span class="mar-table-title">{{
              b.name
            }}</span></span
          >
        </span>
        <span class="mar-table-cell" role="cell">{{ versionsOf(b)[0]?.label ?? '—' }}</span>
        <span class="mar-table-cell is-num" role="cell">{{ deploymentsOf(b.id).length }}</span>
        <span class="mar-table-cell is-num" role="cell">{{ projectsOf(b.id).length }}</span>
        <span class="mar-table-cell is-end" role="cell">{{ b.lastUsed }}</span>
      </div>
    </div>

    <SectionHeader :title="`Deployments · ${deployments.length}`" />
    <DeploymentsTable :list="deployments" :projects-of="projectsOf" />
  </MarPage>
</template>
