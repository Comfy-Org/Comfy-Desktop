<script setup lang="ts">
import { computed, ref } from 'vue'
import { LayoutGrid, Waypoints } from 'lucide-vue-next'
import EmptyState from '../ui/EmptyState.vue'
import PageHeader from '../ui/PageHeader.vue'
import SearchInput from '../ui/SearchInput.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import ToolCard from '../parts/space/ToolCard.vue'
import { currentSpace, STUDIO, type Flavor } from '../spaces'
import { proto } from '../useProto'

/** Everything the studio published into this space. */
const kind = ref<'all' | Flavor>('all')
const q = ref('')
const visible = computed(() => currentSpace.value.catalog.filter((c) => c.visible))
const list = computed(() =>
  visible.value
    .filter((c) => kind.value === 'all' || c.flavor === kind.value)
    .filter((c) => `${c.name} ${c.blurb}`.toLowerCase().includes(q.value.toLowerCase()))
)
</script>

<template>
  <div class="mx-auto w-full max-w-280 px-10 pb-16">
    <PageHeader title="Tools" :description="`Built for ${currentSpace.name} by ${STUDIO.name}.`" />
    <div class="mb-4 flex items-center justify-between gap-3">
      <SegmentedControl
        v-model="kind"
        variant="contained"
        :options="[
          { value: 'all', label: 'All', count: visible.length },
          { value: 'app', label: 'Apps', icon: LayoutGrid },
          { value: 'workflow', label: 'Workflows', icon: Waypoints }
        ]"
      />
      <SearchInput v-model="q" placeholder="Search tools" class="w-56" />
    </div>
    <div v-if="list.length" class="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
      <ToolCard v-for="t in list" :key="t.id" :item="t" @open="proto.portalPage = `tool:${t.id}`" />
    </div>
    <EmptyState v-else :icon="LayoutGrid" title="No tools" description="Nothing matches." />
  </div>
</template>
