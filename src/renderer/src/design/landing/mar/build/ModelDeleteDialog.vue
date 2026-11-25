<script setup lang="ts">
import { computed } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'
import { toast } from '../../useProto'
import { fmtSize, MODEL_BUILDS, modelById, modelsApi, type Model } from './models'

/** Deleting a model frees space but breaks the workflows that load it, so
 *  the confirmation names them before anything is removed. */
const ids = defineModel<string[]>({ required: true })
const emit = defineEmits<{ deleted: [] }>()

const models = computed(() => ids.value.map(modelById).filter((x): x is Model => Boolean(x)))
const size = computed(() => models.value.reduce((n, x) => n + x.sizeGb, 0))
const builds = computed(() => [...new Set(models.value.flatMap((x) => x.usedBy))])
const workflows = computed(() => [...new Set(models.value.flatMap((x) => x.workflows))])
const open = computed({
  get: () => ids.value.length > 0,
  set: (v) => {
    if (!v) ids.value = []
  }
})

function confirm(): void {
  const n = models.value.length
  for (const x of models.value) modelsApi.remove(x.id)
  toast(n === 1 ? `Deleted ${models.value[0]?.file}` : `Deleted ${n} models`)
  ids.value = []
  emit('deleted')
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent size="md" class="px-6 pt-6 pb-5">
      <DialogTitle class="pr-8 text-heading font-semibold">
        {{ models.length === 1 ? `Delete ${models[0]?.name}?` : `Delete ${models.length} models?` }}
      </DialogTitle>
      <DialogDescription class="mt-2 text-ui leading-relaxed text-muted-foreground">
        Frees {{ fmtSize(size) }}. The file{{ models.length === 1 ? '' : 's' }} go{{
          models.length === 1 ? 'es' : ''
        }}
        to the Trash, so you can still restore {{ models.length === 1 ? 'it' : 'them' }} from there.
      </DialogDescription>
      <div v-if="builds.length || workflows.length" class="mm-del-warn">
        <TriangleAlert :size="15" class="mt-0.5 shrink-0" />
        <div>
          <p class="font-medium">These will stop running until you download it again</p>
          <p v-if="builds.length" class="mt-1 text-muted-foreground">
            Builds: {{ builds.map((b) => MODEL_BUILDS[b] ?? b).join(', ') }}
          </p>
          <p v-if="workflows.length" class="mt-0.5 text-muted-foreground">
            Workflows: {{ workflows.join(', ') }}
          </p>
        </div>
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" @click="open = false">Cancel</Button>
        <Button variant="destructive" @click="confirm">Delete</Button>
      </div>
    </DialogContent>
  </DialogRoot>
</template>

<style scoped>
.mm-del-warn {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-status-warning, #f5b14c) 12%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
  line-height: 1.45;
}
.mm-del-warn svg {
  color: var(--color-status-warning, #f5b14c);
}
</style>
