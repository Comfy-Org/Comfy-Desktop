<script setup lang="ts">
import Card from '../ui/Card.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import { computed } from 'vue'
import { MORE_APPS, STARTER_APPS, openApp } from '../appFlow'
import { appsStage } from './apps/appsStage'
import { homeApps } from './homeApps'
import ExampleArc from './userStates/ExampleArc.vue'
import { can } from '../milestones'
import { thumb } from '../mock'
import { go } from '../useProto'

/** Home's apps (UI Playground › Apps on Home): the starter set on the arc
 *  carousel, or four per row with cover on top and name and blurb below
 *  (`grid` forces it where examples already take the arc). A click opens
 *  the app, no graph. */
const { grid = false } = defineProps<{ grid?: boolean }>()
const apps = computed(() =>
  appsStage.id === 'm3' ? [...STARTER_APPS, ...MORE_APPS] : STARTER_APPS
)
// The arc needs eight cards to wrap around; a shorter set goes round twice.
const arc = computed(() => {
  const items = apps.value.map((a) => ({
    label: a.name,
    meta: a.blurb,
    src: thumb(a.thumbId),
    run: () => openApp(a.id)
  }))
  return items.length < 8 ? [...items, ...items] : items
})
</script>

<template>
  <section class="mt-10">
    <SectionHeader title="Apps" :link="can.explore ? 'All apps' : undefined" @link="go('apps')" />
    <ExampleArc
      v-if="!grid && homeApps.id === 'on'"
      :key="arc.length"
      :items="arc"
      label="Apps"
      action="Open"
      headed
    />
    <div v-else class="grid grid-cols-4 gap-3.5">
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
