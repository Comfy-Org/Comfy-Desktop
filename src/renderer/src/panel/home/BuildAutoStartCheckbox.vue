<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Checkbox from '@comfyorg/design-system/checkbox/Checkbox'

defineProps<{ checked?: boolean }>()

const emit = defineEmits<{ 'update:checked': [checked: boolean] }>()

const { t } = useI18n()
</script>

<template>
  <label
    class="flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs/4 whitespace-nowrap text-muted-foreground select-none hover:text-foreground"
    :title="t('home.autoStartHint')"
  >
    <Checkbox
      :model-value="checked"
      @update:model-value="emit('update:checked', $event === true)"
    />
    {{ t('home.autoStart') }}
  </label>
</template>
