<script setup lang="ts">
import { computed, ref } from 'vue'
import { Images } from 'lucide-vue-next'
import EmptyState from '../ui/EmptyState.vue'
import PageHeader from '../ui/PageHeader.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import Select from '../ui/Select.vue'
import OutputTile from '../parts/space/OutputTile.vue'
import { currentSpace } from '../spaces'

/** Everything the team made in this space. Stays in this space only. */
const space = computed(() => currentSpace.value)
const status = ref<'all' | 'fav' | 'review'>('all')
const tool = ref('all')
const list = computed(() =>
  space.value.library
    .filter((o) =>
      status.value === 'all' ? true : status.value === 'fav' ? o.fav : o.status !== 'approved'
    )
    .filter((o) => tool.value === 'all' || o.tool === tool.value)
)
</script>

<template>
  <div class="mx-auto w-full max-w-280 px-10 pb-16">
    <PageHeader
      title="Library"
      :description="`Everything your team made in ${space.name}. Kept for ${space.policies.retention} days.`"
    />
    <div class="mb-4 flex items-center gap-2">
      <SegmentedControl
        v-model="status"
        variant="contained"
        :options="[
          { value: 'all', label: 'All', count: space.library.length },
          { value: 'fav', label: 'Favourites' },
          ...(space.policies.approval
            ? [{ value: 'review' as const, label: 'Waiting for review' }]
            : [])
        ]"
      />
      <Select
        v-model="tool"
        class="w-52"
        :options="[
          { value: 'all', label: 'All tools' },
          ...space.catalog.map((c) => ({ value: c.name, label: c.name }))
        ]"
      />
    </div>
    <div v-if="list.length" class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5">
      <OutputTile v-for="o in list" :key="o.id" :out="o" :space />
    </div>
    <EmptyState
      v-else
      :icon="Images"
      title="Nothing here yet"
      description="Run a tool to fill your library."
    />
  </div>
</template>
