<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Link } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'
import Input from '../../ui/Input.vue'
import { toast } from '../../useProto'
import { modelsApi } from './models'

/** Download a model from a Hugging Face or Civitai link (the frontend's
 *  UploadModelUrlInput flow): paste, check, then it joins the queue. */
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ added: [id: string] }>()
const url = ref('')
watch(open, (v) => v && (url.value = ''))

const error = computed(() => {
  const v = url.value.trim()
  if (!v) return ''
  if (!/^https?:\/\//.test(v)) return 'Paste a full link, starting with https://'
  if (!/\.(safetensors|ckpt|pth|pt|gguf)(\?|$)/i.test(v))
    return 'Link to the model file itself (.safetensors, .ckpt, .pth, .gguf)'
  return ''
})

function submit(): void {
  if (!url.value.trim() || error.value) return
  const model = modelsApi.importUrl(url.value.trim())
  if (!model) return
  toast(`Downloading ${model.file}`)
  emit('added', model.id)
  open.value = false
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent size="md" class="px-6 pt-6 pb-5">
      <DialogTitle class="text-heading font-semibold">Add a model from a link</DialogTitle>
      <DialogDescription class="mt-2 text-ui leading-relaxed text-muted-foreground">
        Hugging Face and Civitai links work. It downloads into your models folder, where every build
        can use it.
      </DialogDescription>
      <form class="mt-4" @submit.prevent="submit">
        <Input v-model="url" placeholder="https://huggingface.co/…/model.safetensors" autofocus>
          <template #leading><Link :size="14" class="shrink-0 text-subtle-foreground" /></template>
        </Input>
        <p v-if="error" class="mt-2 text-ui text-status-danger">{{ error }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
          <Button type="submit" variant="primary" :disabled="!url.trim() || Boolean(error)"
            >Download</Button
          >
        </div>
      </form>
    </DialogContent>
  </DialogRoot>
</template>
