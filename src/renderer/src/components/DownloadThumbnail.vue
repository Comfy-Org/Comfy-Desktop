<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloadThumbnail, type ThumbnailFetcher } from '../composables/useDownloadThumbnail'

const props = defineProps<{
  entry: { isImage?: boolean; status: string; savePath?: string; filename: string }
  fetcher: ThumbnailFetcher
}>()

const { t } = useI18n()

const thumbnail = useDownloadThumbnail(() => props.entry, props.fetcher)

const failed = ref(false)
watch(thumbnail, () => {
  failed.value = false
})
</script>

<template>
  <img
    v-if="thumbnail && !failed"
    :src="thumbnail"
    :alt="t('downloadsPopup.thumbnailAlt', { name: entry.filename })"
    class="download-thumb block size-full object-cover"
    loading="lazy"
    decoding="async"
    draggable="false"
    @error="failed = true"
  />
  <slot v-else name="fallback" />
</template>
