<script setup lang="ts">
import { computed, ref } from 'vue'
import PageHeader from '../ui/PageHeader.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import Tabs from '../ui/Tabs.vue'
import TemplateCard from '../parts/TemplateCard.vue'
import ExploreApps from '../parts/apps/ExploreApps.vue'
import { TEMPLATES } from '../mock'
import { can } from '../milestones'

/** Explore. It leads with apps (use cases anyone can run); from Explore &
 *  Learn on, templates, models and tutorials follow as tabs. */
const tab = ref<'apps' | 'templates' | 'models' | 'tutorials'>('apps')
const cat = ref<'all' | 'image' | 'video' | '3d'>('all')
const list = computed(() =>
  [...TEMPLATES, ...TEMPLATES.slice(0, 4)].filter(
    (t) => cat.value === 'all' || t.category === cat.value
  )
)
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader title="Explore" />
    <ExploreApps v-if="!can.explore" />
    <Tabs
      v-else
      v-model="tab"
      :options="[
        { value: 'apps', label: 'Apps' },
        { value: 'templates', label: 'Templates' },
        { value: 'models', label: 'Models' },
        { value: 'tutorials', label: 'Tutorials' }
      ]"
    >
      <ExploreApps v-if="tab === 'apps'" />
      <template v-else>
        <SegmentedControl
          v-model="cat"
          class="mt-4.5 mb-3.5"
          :options="[
            { value: 'all', label: 'All' },
            { value: 'image', label: 'Image' },
            { value: 'video', label: 'Video' },
            { value: '3d', label: '3D' }
          ]"
        />
        <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
          <TemplateCard v-for="(t, i) in list" :key="`${t.id}-${i}`" :t />
        </div>
      </template>
    </Tabs>
  </div>
</template>
