<script setup lang="ts">
import ScrollRow from '../ui/ScrollRow.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import TemplateCard from './TemplateCard.vue'
import { go } from '../useProto'
import { can } from '../milestones'
import { TEMPLATES } from '../mock'

/** Example workflows to run, as a row; "Explore all" once Explore exists
 *  (Milestone 5). */
const { title = 'Featured templates' } = defineProps<{ title?: string }>()
const list = TEMPLATES.filter((t) => t.kind === 'graph')
</script>

<template>
  <section class="mt-10">
    <SectionHeader v-if="can.explore" :title link="Explore all" @link="go('explore')" />
    <SectionHeader v-else :title />
    <ScrollRow><TemplateCard v-for="t in list" :key="t.id" :t /></ScrollRow>
  </section>
</template>
