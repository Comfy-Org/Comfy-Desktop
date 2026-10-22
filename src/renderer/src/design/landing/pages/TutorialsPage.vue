<script setup lang="ts">
import { computed, ref } from 'vue'
import { GraduationCap } from 'lucide-vue-next'
import EmptyState from '../ui/EmptyState.vue'
import PageHeader from '../ui/PageHeader.vue'
import SearchInput from '../ui/SearchInput.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import TutorialCard from '../parts/TutorialCard.vue'
import { TUTORIALS, type Tutorial } from '../mock'

const cat = ref<'All' | Tutorial['category']>('All')
const q = ref('')
const list = computed(() =>
  TUTORIALS.filter((t) => cat.value === 'All' || t.category === cat.value).filter((t) =>
    `${t.title} ${t.blurb}`.toLowerCase().includes(q.value.toLowerCase())
  )
)
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader
      title="Tutorials"
      description="Learn ComfyUI with hands-on lessons, from your first node graph to VFX, animation and ads."
    />
    <div class="mb-4 flex items-center justify-between gap-3">
      <SegmentedControl
        v-model="cat"
        :options="
          (['All', 'Basics', 'VFX', 'Animations', 'Ads'] as const).map((c) => ({
            value: c,
            label: c
          }))
        "
      />
      <SearchInput v-model="q" placeholder="Search tutorials" class="w-56" />
    </div>
    <div v-if="list.length" class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
      <TutorialCard v-for="t in list" :key="t.title" :t />
    </div>
    <EmptyState
      v-else
      :icon="GraduationCap"
      title="No tutorials found"
      :description="`Nothing matches “${q}”.`"
    />
  </div>
</template>
