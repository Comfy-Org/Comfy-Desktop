<script setup lang="ts">
import { computed, ref } from 'vue'
import { Cloud, Download, Laptop, Loader2 } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { APP_RUNS, downloaded } from './appsStage'

/** M2 of the Apps PRD: before Run, whether this machine can run the app,
 *  which parts run where, and the models to download with their size. */
const { id } = defineProps<{ id: string }>()
const run = computed(() => APP_RUNS[id]!)
const fetching = ref(false)
const ready = computed(() => Boolean(downloaded[id]))

function download(): void {
  fetching.value = true
  setTimeout(() => {
    fetching.value = false
    downloaded[id] = true
  }, 1400)
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-card bg-secondary-background/40 p-3 text-ui">
    <p class="flex items-center gap-2 font-medium">
      <Cloud v-if="run.kind === 'cloud'" :size="14" /><Laptop v-else :size="14" />
      {{
        run.kind === 'cloud'
          ? 'Needs cloud'
          : run.kind === 'split'
            ? 'Runs partly on this computer'
            : 'Runs locally'
      }}
    </p>
    <p v-if="run.kind === 'cloud'" class="text-subtle-foreground">
      This computer doesn't have enough GPU memory for it.
    </p>
    <dl v-if="run.kind === 'split'" class="flex flex-col gap-1 text-subtle-foreground">
      <div class="flex justify-between gap-3">
        <dt>{{ run.local }}</dt>
        <dd>This computer</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt>{{ run.cloud }}</dt>
        <dd>Comfy Cloud</dd>
      </div>
    </dl>
    <template v-if="run.kind !== 'cloud'">
      <p v-if="ready" class="text-subtle-foreground">
        Models ready{{ run.kind === 'local' ? '. Works offline.' : '.' }}
      </p>
      <div v-else class="flex items-center justify-between gap-3">
        <span class="text-subtle-foreground">{{ run.download }} · 480 GB free</span>
        <Button size="sm" :disabled="fetching" @click="download">
          <Loader2 v-if="fetching" :size="12" class="animate-spin" /><Download
            v-else
            :size="12"
          />{{ fetching ? 'Downloading' : 'Download models' }}
        </Button>
      </div>
    </template>
  </div>
</template>
