<script setup lang="ts">
import { computed } from 'vue'
import HomeFeedTile from './HomeFeedTile.vue'
import HomeMiniCard from './HomeMiniCard.vue'
import HomeSectionHeader from '../HomeSectionHeader.vue'
import type { RecentListRow } from '../RecentList.vue'
import { exploreAll, feedApps, feedWorkflows } from './homeFeed'
import { can } from '../../milestones'
import { go } from '../../useProto'
import { openCreate } from '../create/createScreen'
import { recentsCover } from '../cover'

const { rows } = defineProps<{ rows: RecentListRow[] }>()
const emit = defineEmits<{ openRecent: [id: string] }>()

const apps = feedApps()
const big = apps[0]!
const small = apps.slice(1, 5)
const medium = computed(() => (can.value.explore ? feedWorkflows().slice(0, 2) : apps.slice(5, 7)))
const recentSrc = (r: RecentListRow): string | undefined =>
  recentsCover.id === 'image' ? r.src : undefined
</script>

<template>
  <section v-if="rows.length">
    <HomeSectionHeader
      title="Recently used"
      link-tip="All workflows"
      add-label="New workflow"
      add="always"
      @open="go('workflows')"
      @add="openCreate()"
    />
    <div class="hvb-recents">
      <HomeMiniCard
        v-for="r in rows"
        :key="r.id"
        :title="r.name"
        :line="[r.build, r.edited].filter(Boolean).join(' · ')"
        :src="recentSrc(r)"
        @open="emit('openRecent', r.id)"
      />
    </div>
  </section>

  <section class="hvb" :class="rows.length > 0 && 'mt-9'" data-home-tour="apps-carousel">
    <HomeSectionHeader
      title="Apps and workflows"
      link-tip="Explore"
      add-label="New app"
      @open="exploreAll('apps')"
    />
    <div class="hvb-grid">
      <HomeFeedTile :item="big" class="hvb-tile hvb-big" @open="big.open()" />
      <HomeFeedTile
        v-for="m in medium"
        :key="m.id"
        :item="m"
        class="hvb-tile hvb-medium"
        @open="m.open()"
      />
      <HomeFeedTile v-for="s in small" :key="s.id" :item="s" class="hvb-tile" @open="s.open()" />
    </div>
  </section>
</template>

<style>
.hvb-recents {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.hvb-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: clamp(180px, 16vw, 230px);
  gap: 10px;
}
:root .proto-ui.proto-ui.proto-ui .hvb-tile {
  min-height: 0;
}
:root .proto-ui.proto-ui.proto-ui .hvb-tile > div:first-child {
  min-height: 0;
  flex: 1 1 0;
  aspect-ratio: auto !important;
}
:root .proto-ui.proto-ui.proto-ui .hvb-tile > div:last-child {
  flex: none;
}
:root .proto-ui.proto-ui.proto-ui .hvb-big {
  grid-row: span 2;
  grid-column: span 2;
}
:root .proto-ui.proto-ui.proto-ui .hvb-medium {
  grid-column: span 2;
}
</style>
