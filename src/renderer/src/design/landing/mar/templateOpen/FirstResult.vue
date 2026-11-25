<script setup lang="ts">
import { ImagePlus, PenLine, X } from 'lucide-vue-next'

const { src, name } = defineProps<{ src: string; name: string }>()
const emit = defineEmits<{ prompt: []; image: []; close: [] }>()
</script>

<template>
  <div class="mg-toast fr" role="status" data-first-result>
    <img :src="src" alt="" />
    <span class="fr-text">
      <span class="fr-title">Your first {{ name }} result</span>
      <span class="fr-sub">Now make it yours</span>
    </span>
    <button type="button" class="mg-toast-btn fr-btn" @click="emit('image')">
      <ImagePlus :size="14" />Try your own image
    </button>
    <button type="button" class="mg-toast-btn fr-btn" @click="emit('prompt')">
      <PenLine :size="14" />Change the prompt
    </button>
    <button type="button" class="fr-x" aria-label="Dismiss" @click="emit('close')">
      <X :size="14" />
    </button>
  </div>
</template>

<style>
.mg-toast.fr {
  height: 56px;
  padding: 0 8px;
  gap: 12px;
}
.mg-toast.fr img {
  width: 40px;
  height: 40px;
}
.fr-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding-right: 8px;
  line-height: 17px;
}
.fr-title {
  font-weight: 500;
  white-space: nowrap;
}
.fr-sub {
  color: var(--mg-muted);
  font-size: 12px;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .mg-toast-btn.fr-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .fr-x {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: var(--mar-tab-item-radius);
  color: var(--mg-muted);
}
:root .proto-ui.proto-ui.proto-ui .fr-x:hover {
  background: var(--mg-hover);
  color: var(--mg-text);
}
</style>
