<script setup lang="ts">
import { ref } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import SetupModal from '../components/SetupModal.vue'
import LoadSnapshotForm from '../components/LoadSnapshotForm.vue'
import type { ShowProgressOpts } from '../types/ipc'

const emit = defineEmits<{
  close: []
  'show-progress': [opts: ShowProgressOpts]
}>()

const isOpen = ref(false)
const openCount = ref(0)
const formRef = ref<InstanceType<typeof LoadSnapshotForm> | null>(null)

function open(): void {
  openCount.value++
  isOpen.value = true
}

function handleCreated(opts: ShowProgressOpts): void {
  isOpen.value = false
  emit('close')
  emit('show-progress', opts)
}

defineExpose({ open })
</script>

<template>
  <SetupModal
    v-if="isOpen"
    :dialog-label="$t('loadSnapshot.grandTitle')"
    :title="$t('loadSnapshot.grandTitle')"
    :lead="$t('loadSnapshot.grandSubtitle')"
    dismiss-on-escape
    data-testid="load-snapshot-modal"
    @close="emit('close')"
  >
    <LoadSnapshotForm ref="formRef" :key="openCount" class="mt-4" @created="handleCreated" />

    <template v-if="formRef?.hasPreview" #footer>
      <span class="flex-1" />
      <Button
        type="button"
        size="lg"
        variant="inverted"
        class="load-snapshot-create h-9 min-w-[104px] rounded-[10px]"
        :disabled="!formRef.canCreate"
        @click="formRef.create()"
      >
        {{
          formRef.creating ? `${$t('newInstall.installing')}…` : $t('list.snapshotCreateInstall')
        }}
      </Button>
    </template>
  </SetupModal>
</template>
