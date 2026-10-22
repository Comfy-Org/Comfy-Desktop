<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { FolderPlus } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../ui/Button.vue'
import DialogContent from '../ui/DialogContent.vue'
import Input from '../ui/Input.vue'

/** Path prompt for adding a watched folder (Assets and My Project). */
const { suggestion } = defineProps<{ suggestion: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ add: [path: string] }>()

const path = ref('')
const input = ref<InstanceType<typeof Input>>()
watch(open, async (v) => {
  if (!v) return
  path.value = suggestion
  await nextTick()
  input.value?.select()
})
function submit(): void {
  const p = path.value.trim().replace(/\/+$/, '')
  if (!p) return
  emit('add', p)
  open.value = false
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent class="p-5">
      <DialogTitle class="flex items-center gap-2 text-heading font-semibold"
        ><FolderPlus :size="16" />Add a folder</DialogTitle
      >
      <DialogDescription class="mt-1 mb-4 text-ui text-muted-foreground">
        Its images, videos and audio show up alongside your build folders.
      </DialogDescription>
      <form @submit.prevent="submit">
        <Input ref="input" v-model="path" mono size="lg" aria-label="Folder path" />
        <div class="mt-4 flex justify-end gap-2">
          <Button variant="ghost" @click="open = false">Cancel</Button>
          <Button variant="primary" type="submit">Add folder</Button>
        </div>
      </form>
    </DialogContent>
  </DialogRoot>
</template>
