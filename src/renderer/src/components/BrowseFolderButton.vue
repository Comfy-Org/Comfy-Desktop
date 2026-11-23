<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'

const emit = defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <Button
    size="sm"
    variant="secondary"
    type="button"
    class="browse-folder-button flex-none rounded-lg px-3"
    @click="(event: MouseEvent) => emit('click', event)"
  >
    {{ $t('common.browse') }}
  </Button>
</template>
