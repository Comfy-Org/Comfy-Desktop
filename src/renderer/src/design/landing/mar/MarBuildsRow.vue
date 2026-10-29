<script setup lang="ts">
import { computed } from 'vue'
import { Play } from 'lucide-vue-next'
import Card from '../ui/Card.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import StatusDot from '../ui/StatusDot.vue'
import LocationIcon from '../ui/LocationIcon.vue'
import { envStatus } from '../parts/env/env'
import { go, hostActions, instances, recentInstances } from '../useProto'

/** Home's builds in Mar's proposal (UI Playground › Build on Home): what
 *  Pablo's Home shows (three recent builds, their state, click to launch
 *  ComfyUI on one), as one row of cards like Spaces. */
const shown = computed(() => recentInstances.value.slice(0, 3))
</script>

<template>
  <section class="mt-10">
    <SectionHeader title="Builds" link="All builds" @link="go('environments')">
      <template #controls>
        <span
          class="inline-flex h-5 items-center rounded-full bg-secondary-background px-2 text-ui text-muted-foreground"
          >{{ instances.length }}</span
        >
      </template>
    </SectionHeader>
    <!-- One, two or three builds always fill the row. -->
    <div
      class="grid gap-3.5"
      :style="{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }"
    >
      <Card
        v-for="i in shown"
        :key="i.id"
        as="button"
        interactive
        class="mar-row-card group"
        @click="hostActions.launch(i)"
      >
        <span class="mar-row-icon">
          <LocationIcon :kind="i.kind === 'cloud' ? 'cloud' : 'local'" :size="18" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="block truncate text-ui font-medium">{{ i.name }}</span>
          <span class="flex items-center gap-1.5 truncate text-ui text-subtle-foreground"
            ><StatusDot v-if="envStatus(i).live" status="running" />{{ envStatus(i).label }}</span
          >
        </span>
        <Play
          :size="14"
          class="shrink-0 text-subtle-foreground transition-colors group-hover:text-base-foreground"
        />
      </Card>
    </div>
  </section>
</template>
