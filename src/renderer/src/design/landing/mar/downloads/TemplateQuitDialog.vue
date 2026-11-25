<script setup lang="ts">
import { TriangleAlert } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ quit: [] }>()

const TEMPLATE_QUIT_COPY = {
  title: 'Template models are still downloading',
  message:
    'Quitting now will pause the download. It will appear as a paused item in Downloads next time, where you can resume or cancel it.',
  quit: 'Quit anyway',
  cancel: 'Keep downloading'
} as const

function quit(): void {
  open.value = false
  emit('quit')
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent size="sm" class="p-5" :closable="false" data-template-quit>
      <DialogTitle class="flex items-center gap-2 text-heading font-semibold"
        ><TriangleAlert :size="16" class="shrink-0 text-comfy-yellow" />{{
          TEMPLATE_QUIT_COPY.title
        }}</DialogTitle
      >
      <DialogDescription class="mt-2 mb-5 text-ui text-muted-foreground">
        {{ TEMPLATE_QUIT_COPY.message }}
      </DialogDescription>
      <div class="flex justify-end gap-2">
        <Button variant="ghost" @click="quit">{{ TEMPLATE_QUIT_COPY.quit }}</Button>
        <Button variant="primary" @click="open = false">{{ TEMPLATE_QUIT_COPY.cancel }}</Button>
      </div>
    </DialogContent>
  </DialogRoot>
</template>
