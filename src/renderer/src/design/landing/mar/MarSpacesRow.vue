<script setup lang="ts">
import { computed } from 'vue'
import SectionHeader from '../ui/SectionHeader.vue'
import SpaceCard from '../parts/space/SpaceCard.vue'
import { SPACES } from '../spaces'
import { go } from '../useProto'

/** Home's spaces in Mar's proposal: the three live ones, wide enough for
 *  each card's lines to fit; drafts and the rest are in All spaces. */
const shown = computed(() => SPACES.filter((s) => s.status !== 'draft').slice(0, 3))
</script>

<template>
  <section class="mt-10">
    <SectionHeader title="Spaces" link="All spaces" @link="go('spaces')" />
    <div class="grid grid-cols-3 gap-3.5">
      <SpaceCard v-for="s in shown" :key="s.id" :space="s" />
    </div>
  </section>
</template>
