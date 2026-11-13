<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { AudioLines, Box, Video } from 'lucide-vue-next'
import ImageGlyph from '../components/ImageGlyph.vue'
import type { Component } from 'vue'
import type { CatalogCategory } from '../types/ipc'

const CATEGORY_ICONS: Record<CatalogCategory, Component> = {
  image: ImageGlyph,
  video: Video,
  '3d': Box,
  audio: AudioLines
}

defineProps<{ category: CatalogCategory }>()

const { t } = useI18n()
</script>

<template>
  <span
    class="flex h-[22px] items-center gap-1.5 rounded-full bg-[rgb(14_14_16/0.28)] px-2.5 text-[10px] font-semibold tracking-[0.08em] text-white uppercase backdrop-blur-[14px] backdrop-saturate-150"
    :data-category="category"
  >
    <component :is="CATEGORY_ICONS[category]" :size="11" aria-hidden="true" />
    {{ t(`home.category.${category}`) }}
  </span>
</template>
