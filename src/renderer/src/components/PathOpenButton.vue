<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'

defineProps<{ path: string }>()
defineEmits<{ open: [] }>()
</script>

<template>
  <Button
    size="unset"
    variant="link"
    type="button"
    class="config-path-open block min-w-0 justify-start truncate p-0 text-left text-[13px] font-normal text-neutral-100 hover:underline"
    :title="$t('actions.openDirectory')"
    :aria-label="`${$t('actions.openDirectory')}: ${path}`"
    @click="$emit('open')"
  >
    {{ path }}
  </Button>
</template>
