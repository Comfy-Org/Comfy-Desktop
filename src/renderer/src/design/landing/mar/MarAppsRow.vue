<script setup lang="ts">
import Card from '../ui/Card.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import { computed } from 'vue'
import { MORE_APPS, STARTER_APPS, openApp } from '../appFlow'
import { appsStage } from './apps/appsStage'
import { can } from '../milestones'
import { thumb } from '../mock'
import { go } from '../useProto'

/** Home's apps (UI Playground › Apps on Home): the starter set, four per
 *  row, cover on top with name and blurb below. A click opens the app, no
 *  graph. First run titles it as the way to start. */
const { title = 'Apps' } = defineProps<{ title?: string }>()
const apps = computed(() =>
  appsStage.id === 'm3' ? [...STARTER_APPS, ...MORE_APPS] : STARTER_APPS
)
</script>

<template>
  <section class="mt-10">
    <SectionHeader :title :link="can.explore ? 'All apps' : undefined" @link="go('apps')" />
    <div class="grid grid-cols-4 gap-3.5">
      <Card
        v-for="a in apps"
        :key="a.id"
        as="button"
        interactive
        class="flex min-w-0 flex-col overflow-hidden p-1.5 text-left"
        @click="openApp(a.id)"
      >
        <img
          :src="thumb(a.thumbId)"
          alt=""
          loading="lazy"
          class="aspect-[16/10] w-full rounded-control object-cover"
        />
        <span class="block min-w-0 px-1.5 pt-2.5 pb-1.5">
          <span class="block truncate text-ui font-medium">{{ a.name }}</span>
          <span class="block truncate text-ui text-subtle-foreground">{{ a.blurb }}</span>
        </span>
      </Card>
    </div>
  </section>
</template>
