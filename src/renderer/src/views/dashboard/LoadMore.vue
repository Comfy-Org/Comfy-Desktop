<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Button from '../../design-system/components/Button.vue'

/** The button under a tab's list that fetches its next page. */
const { loading } = defineProps<{ loading: boolean }>()
const emit = defineEmits<{ load: [] }>()

const { t } = useI18n()
</script>

<template>
  <div class="mt-4 flex justify-center">
    <Button :disabled="loading" @click="emit('load')">{{ t('buildsDashboard.loadMore') }}</Button>
  </div>
</template>
