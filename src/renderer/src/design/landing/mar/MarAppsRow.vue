<script setup lang="ts">
import Card from '../ui/Card.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import { computed } from 'vue'
import { MORE_APPS, STARTER_APPS, openApp } from '../appFlow'
import { appsStage } from './apps/appsStage'
import { can } from '../milestones'
import { thumb } from '../mock'
import { go } from '../useProto'

/** Home's apps (UI Playground › Apps on Home): the starter set, named by
 *  what you get, never by a model. A click opens the app, no graph. First
 *  run titles it as the way to start. */
const { title = 'Apps' } = defineProps<{ title?: string }>()
const apps = computed(() =>
  appsStage.id === 'm3' ? [...STARTER_APPS, ...MORE_APPS] : STARTER_APPS
)
</script>

<template>
  <section class="mt-10">
    <SectionHeader :title :link="can.explore ? 'All apps' : undefined" @link="go('apps')" />
    <div class="grid grid-cols-3 gap-3.5">
      <Card
        v-for="a in apps"
        :key="a.id"
        as="button"
        interactive
        class="flex h-20 items-center gap-4 overflow-hidden text-left"
        @click="openApp(a.id)"
      >
        <img :src="thumb(a.thumbId)" alt="" loading="lazy" class="size-20 shrink-0 object-cover" />
        <span class="truncate pr-4 text-ui font-medium">{{ a.name }}</span>
      </Card>
    </div>
  </section>
</template>
