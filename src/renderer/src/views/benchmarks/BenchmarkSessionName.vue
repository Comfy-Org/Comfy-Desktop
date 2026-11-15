<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { Pencil } from 'lucide-vue-next'
import { useInlineTextEdit } from '../../composables/useInlineTextEdit'

const props = defineProps<{
  name: string
  label: string
  rename: (name: string) => Promise<boolean>
}>()

const field = useTemplateRef<HTMLElement>('field')
const { focus, onKeydown, onPaste, onBlur } = useInlineTextEdit(field, {
  value: () => props.name,
  commit: (name) => props.rename(name)
})

defineExpose({ focus })
</script>

<template>
  <span
    class="benchmarks__session-name group/session-name -mx-1 inline-flex max-w-full min-w-0 items-center gap-1.5"
  >
    <span
      ref="field"
      class="benchmarks__session-name-text min-w-0 cursor-text truncate rounded-md px-1 text-[13px] font-medium text-foreground outline-none transition-colors hover:bg-foreground/6 focus-visible:bg-foreground/6 focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]"
      role="textbox"
      :aria-label="label"
      :title="label"
      contenteditable="plaintext-only"
      spellcheck="false"
      @blur="onBlur"
      @keydown="onKeydown"
      @paste="onPaste"
    />
    <Pencil
      :size="12"
      class="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/session-name:opacity-100"
      aria-hidden="true"
    />
  </span>
</template>
