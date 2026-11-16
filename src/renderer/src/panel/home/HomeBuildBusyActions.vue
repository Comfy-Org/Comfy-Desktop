<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'

defineProps<{ canViewLogs: boolean; cancelling?: boolean }>()

const emit = defineEmits<{ 'view-logs': []; cancel: [] }>()

const { t } = useI18n()
</script>

<template>
  <span class="flex shrink-0 items-center gap-2">
    <Button
      v-if="canViewLogs"
      type="button"
      variant="muted-textonly"
      size="unset"
      class="h-8 rounded-lg px-3 text-[13px]/5 font-normal hover:bg-secondary hover:text-foreground"
      data-testid="home-build-view-logs"
      @click="emit('view-logs')"
    >
      {{ t('installProgress.viewLogs') }}
    </Button>
    <Button
      type="button"
      variant="secondary"
      size="unset"
      class="h-8 rounded-lg px-3 text-[13px]/5 font-normal"
      :disabled="cancelling"
      data-testid="home-build-cancel"
      @click="emit('cancel')"
    >
      {{ t('common.cancel') }}
    </Button>
  </span>
</template>
