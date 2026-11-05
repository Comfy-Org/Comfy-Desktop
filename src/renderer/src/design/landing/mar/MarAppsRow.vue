<script setup lang="ts">
import Card from '../ui/Card.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import { STARTER_APPS, openApp } from '../appFlow'
import { can } from '../milestones'
import { thumb } from '../mock'
import { go } from '../useProto'

/** Home's apps (UI Playground › Apps on Home): the starter set, named by
 *  what you get, never by a model. A click opens the app, no graph. */
</script>

<template>
  <section class="mt-10">
    <SectionHeader title="Apps" :link="can.explore ? 'All apps' : undefined" @link="go('apps')" />
    <div class="grid grid-cols-3 gap-3.5">
      <Card
        v-for="a in STARTER_APPS"
        :key="a.id"
        as="button"
        interactive
        padding="none"
        class="group overflow-hidden text-left"
        @click="openApp(a.id)"
      >
        <img
          :src="thumb(a.thumbId)"
          alt=""
          loading="lazy"
          class="aspect-16/9 w-full object-cover"
        />
        <span class="flex flex-col gap-0.5 px-3.5 py-3">
          <span class="truncate text-ui font-medium">{{ a.name }}</span>
          <span class="truncate text-ui text-subtle-foreground">{{ a.blurb }}</span>
        </span>
      </Card>
    </div>
  </section>
</template>
