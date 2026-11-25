<script setup lang="ts">
import { ref } from 'vue'
import Button from '../../ui/Button.vue'
import { OFFLINE_COPY } from './connection'

const { kind = 'apps' } = defineProps<{ kind?: 'apps' | 'workflows' }>()
const trying = ref(false)
function retry(): void {
  trying.value = true
  setTimeout(() => (trying.value = false), 700)
}
</script>

<template>
  <div
    class="flex h-75 flex-col items-center justify-center gap-3"
    :data-testid="`home-${kind}-failed`"
  >
    <p class="m-0 text-[13px]/5 text-muted-foreground">
      {{ kind === 'apps' ? OFFLINE_COPY.homeApps : OFFLINE_COPY.homeWorkflows }}
    </p>
    <Button variant="secondary" size="md" :disabled="trying" @click="retry">
      {{ OFFLINE_COPY.retry }}
    </Button>
  </div>
</template>
