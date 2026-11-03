<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import MediaCard from '../../ui/MediaCard.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import MemberAvatar from '../MemberAvatar.vue'
import { thumb } from '../../mock'
import { can } from '../../milestones'
import { EXPLORE, isAdded, openAppUrl, toggleAdded, usd } from '../../appFlow'

/**
 * Explore, apps first: use cases people can run right away, from creators
 * and from Comfy. An app opens in its own tab, as its user - Run, and who
 * pays under it. There is no admin view here: these apps are not yours.
 */
const cat = ref('all')
const sections = computed(() => EXPLORE.filter((s) => cat.value === 'all' || s.title === cat.value))
</script>

<template>
  <div>
    <SegmentedControl
      v-model="cat"
      class="mt-4.5 mb-8"
      :options="[
        { value: 'all', label: 'All' },
        ...EXPLORE.map((s) => ({ value: s.title, label: s.title }))
      ]"
    />
    <section v-for="s in sections" :key="s.title" class="mb-10">
      <SectionHeader :title="s.title">
        <template #controls>
          <span class="text-ui text-subtle-foreground">{{ s.hint }}</span>
        </template>
      </SectionHeader>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
        <MediaCard
          v-for="a in s.apps"
          :key="a.id"
          :src="thumb(a.thumbId)"
          :aria-label="`Open ${a.name}`"
          @click="openAppUrl(a.id)"
          @keydown.enter="openAppUrl(a.id)"
        >
          <!-- No library yet at Explore apps, so nothing to add to. -->
          <template v-if="can.explore" #top-right>
            <Button
              variant="overlay"
              size="sm"
              :aria-pressed="isAdded(a.id)"
              :aria-label="`${isAdded(a.id) ? 'Remove' : 'Add'} ${a.name} ${isAdded(a.id) ? 'from' : 'to'} my apps`"
              @click.stop="toggleAdded(a)"
              @keydown.enter.stop
            >
              <Check v-if="isAdded(a.id)" :size="12" /><Plus v-else :size="12" />{{
                isAdded(a.id) ? 'Added' : 'Add'
              }}
            </Button>
          </template>
          <span class="block truncate text-ui font-medium">{{ a.name }}</span>
          <span class="mt-0.5 block truncate text-ui text-muted-foreground">{{ a.blurb }}</span>
          <span class="mt-3 flex items-center gap-2 text-ui text-subtle-foreground">
            <MemberAvatar :name="a.owner" size="sm" />
            <span class="min-w-0 flex-1 truncate">{{ a.owner }}</span>
            <span class="tabular-nums">{{ usd(a.cost) }} a run</span>
          </span>
        </MediaCard>
      </div>
    </section>
  </div>
</template>
