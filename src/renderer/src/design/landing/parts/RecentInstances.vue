<script setup lang="ts">
import { computed } from 'vue'
import SectionHeader from '../ui/SectionHeader.vue'
import GetStarted from './GetStarted.vue'
import InstanceCard from './InstanceCard.vue'
import NewInstanceCard from './NewInstanceCard.vue'
import { go, recentInstances } from '../useProto'

const { title = 'Recently used builds', limit = 3 } = defineProps<{
  title?: string
  limit?: number
}>()
const hasLocal = computed(() => recentInstances.value.some((i) => i.kind === 'local'))
</script>

<template>
  <GetStarted v-if="!hasLocal" class="mt-10" />
  <section v-else class="mt-10">
    <SectionHeader :title link="All builds" @link="go('instances')" />
    <div class="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,0.7fr)] gap-3.5">
      <InstanceCard v-for="i in recentInstances.slice(0, limit)" :key="i.id" :inst="i" />
      <NewInstanceCard compact />
    </div>
  </section>
</template>
