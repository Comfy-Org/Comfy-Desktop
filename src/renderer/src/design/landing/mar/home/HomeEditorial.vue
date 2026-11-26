<script setup lang="ts">
import LaunchBanner from '../LaunchBanner.vue'
import HomeMiniCard from './HomeMiniCard.vue'
import HomeRecents from './HomeRecents.vue'
import HomeSectionHeader from '../HomeSectionHeader.vue'
import type { RecentListRow } from '../RecentList.vue'
import { exploreAll, newTemplates } from './homeFeed'
import { can } from '../../milestones'

defineProps<{ rows: RecentListRow[] }>()
const emit = defineEmits<{ openRecent: [id: string] }>()

const templates = newTemplates(3)
</script>

<template>
  <LaunchBanner class="hve-banner" data-home-tour="apps-carousel" />
  <div class="hve-cols">
    <HomeRecents v-if="rows.length" :rows="rows" @open="(id) => emit('openRecent', id)" />
    <section v-if="can.explore">
      <HomeSectionHeader
        title="New templates"
        link-tip="All templates"
        add-label="New workflow"
        @open="exploreAll('templates')"
      />
      <div class="hve-templates">
        <HomeMiniCard
          v-for="t in templates"
          :key="t.id"
          :title="t.title"
          :line="t.line"
          :src="t.src"
          @open="t.open()"
        />
      </div>
    </section>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .hve-banner {
  margin-top: 0;
}
.hve-cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 36px;
  margin-top: 36px;
}
.hve-templates {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
</style>
