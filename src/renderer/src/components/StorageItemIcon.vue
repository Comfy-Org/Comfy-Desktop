<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { FolderSymlink } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

interface Props {
  icon: Component
  shared?: boolean
  title?: string
}
const props = defineProps<Props>()

const { t } = useI18n()

const resolvedIcon = computed(() => (props.shared ? FolderSymlink : props.icon))
const resolvedTitle = computed(() => (props.shared ? t('tooltips.sharedDir') : props.title))
</script>

<template>
  <component
    :is="resolvedIcon"
    :size="14"
    class="storage-item-icon shrink-0 text-text-muted"
    :class="{ 'is-shared': shared }"
    :title="resolvedTitle"
    aria-hidden="true"
  />
</template>
