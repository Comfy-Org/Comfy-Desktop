<script setup lang="ts">
import { onMounted, ref } from 'vue'
import InstallWizardModal from '../src/renderer/src/views/InstallWizardModal.vue'
import ModalDialog from '../src/renderer/src/components/ModalDialog.vue'
import type { ShowProgressOpts } from '../src/types/ipc'

const wizard = ref<InstanceType<typeof InstallWizardModal>>()
const visible = ref(true)
const message = ref('')

onMounted(() => {
  void wizard.value?.open()
})

function showProgress(opts: ShowProgressOpts): void {
  message.value = `Simulated installation requested for ${opts.installationId}. No files were written.`
}
</script>

<template>
  <InstallWizardModal
    v-if="visible"
    ref="wizard"
    @close="visible = false"
    @navigate-list="visible = false"
    @show-progress="showProgress"
  />
  <ModalDialog />
  <div v-if="!visible" class="preview-result">
    <p role="status">
      {{ message || 'Setup closed. Use the Storybook toolbar to remount this example.' }}
    </p>
  </div>
</template>

<style scoped>
.preview-result {
  padding: 32px;
}
</style>
