<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { FolderOpen } from '@lucide/vue'
import { revealInFolderKey } from '../composables/usePlatform'

const props = defineProps<{ path?: string }>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()

const { t } = useI18n()
const revealFolderKey = revealInFolderKey(window.api?.platform)
const revealLabel = computed(() => t(revealFolderKey))
const ariaLabel = computed(() =>
  props.path ? `${revealLabel.value}: ${props.path}` : revealLabel.value
)
</script>

<template>
  <Button
    type="button"
    variant="muted-textonly"
    size="icon"
    class="reveal-folder-button size-7 shrink-0"
    :aria-label="ariaLabel"
    :title="revealLabel"
    @click="(event: MouseEvent) => emit('click', event)"
  >
    <FolderOpen :size="14" aria-hidden="true" />
  </Button>
</template>
