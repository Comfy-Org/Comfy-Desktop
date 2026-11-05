<script setup lang="ts">
import MediaCard from '../ui/MediaCard.vue'
import { openDetail } from '../useProto'
import { thumb, type Template } from '../mock'
import CategoryChip from '../mar/CategoryChip.vue'
import FavoriteStar from '../mar/FavoriteStar.vue'
import BrandedThumb from '../mar/brand/BrandedThumb.vue'
import { templateStyle } from '../mar/brand/templateStyle'

const { t } = defineProps<{ t: Template }>()
</script>

<template>
  <MediaCard
    :src="thumb(t.id)"
    @click="openDetail('template', t.id)"
    @keydown.enter="openDetail('template', t.id)"
  >
    <!-- The picture with a small brand touch (mar/brand/). -->
    <template v-if="templateStyle.id !== 'photo'" #media
      ><BrandedThumb :t="t" :kind="templateStyle.id"
    /></template>
    <template #top-left>
      <!-- The real category, named on hover (mar/). -->
      <CategoryChip :category="t.category" />
    </template>
    <template #top-right><FavoriteStar :id="t.id" /></template>
    <p class="truncate text-ui font-medium">{{ t.title }}</p>
  </MediaCard>
</template>
