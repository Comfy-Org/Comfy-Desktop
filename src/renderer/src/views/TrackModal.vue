<script setup lang="ts">
import { ref } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import SetupModal from '../components/SetupModal.vue'
import TrackBuildForm from '../components/TrackBuildForm.vue'

const emit = defineEmits<{
  close: []
  'navigate-list': []
}>()

const isOpen = ref(false)
const openCount = ref(0)
const formRef = ref<InstanceType<typeof TrackBuildForm> | null>(null)

function open(): void {
  openCount.value++
  isOpen.value = true
}

function handleSaved(): void {
  isOpen.value = false
  emit('close')
  emit('navigate-list')
}

defineExpose({ open })
</script>

<template>
  <SetupModal
    v-if="isOpen"
    :dialog-label="$t('track.grandTitle')"
    :title="$t('track.grandTitle')"
    :lead="$t('track.grandSubtitle')"
    dismiss-on-escape
    data-testid="track-modal"
    @close="emit('close')"
  >
    <TrackBuildForm ref="formRef" :key="openCount" class="mt-4" @saved="handleSaved" />

    <template #footer>
      <span class="flex-1" />
      <Button
        type="button"
        size="lg"
        variant="inverted"
        class="track-save min-w-[104px]"
        :disabled="!formRef?.canSave"
        @click="formRef?.save()"
      >
        {{ $t('track.trackInstallation') }}
      </Button>
    </template>
  </SetupModal>
</template>
