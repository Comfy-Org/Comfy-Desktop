<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { AudioLines, Box, Image, Video } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { CatalogCategory } from '../types/ipc'

const CATEGORY_ICONS: Record<CatalogCategory, Component> = {
  image: Image,
  video: Video,
  '3d': Box,
  audio: AudioLines
}

defineProps<{ category: CatalogCategory }>()

const { t } = useI18n()
</script>

<template>
  <span
    class="flex h-[22px] items-center gap-1.5 rounded-full bg-[rgb(14_14_16/0.28)] px-2.5 text-[10px] font-semibold tracking-[0.08em] text-white uppercase backdrop-blur-[14px]"
    :data-category="category"
  >
    <component :is="CATEGORY_ICONS[category]" :size="11" aria-hidden="true" />
    {{ t(`home.category.${category}`) }}
  </span>
</template>
