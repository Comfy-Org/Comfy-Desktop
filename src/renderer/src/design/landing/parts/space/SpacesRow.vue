<script setup lang="ts">
import SectionHeader from '../../ui/SectionHeader.vue'
import SpaceCard from './SpaceCard.vue'
import { SPACES } from '../../spaces'
import { go } from '../../useProto'

/** Studio home: the spaces you run. */
</script>

<template>
  <section class="mt-10">
    <SectionHeader title="Spaces" link="All spaces" @link="go('spaces')" />
    <div class="grid grid-cols-4 gap-3.5">
      <SpaceCard v-for="s in SPACES" :key="s.id" :space="s" />
    </div>
  </section>
</template>
