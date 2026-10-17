<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import type { HTMLAttributes } from 'vue'
import { cn } from '../cn'

/** Text that turns into a field to rename it, in its own type style. The
 *  parent opens it (`editing`); Enter or leaving the field saves, Escape
 *  cancels. An empty or unchanged value cancels. */
const {
  value,
  editing,
  label,
  class: className
} = defineProps<{
  value: string
  editing: boolean
  /** The field's accessible name, e.g. "Rename build". */
  label: string
  class?: HTMLAttributes['class']
}>()
const emit = defineEmits<{ commit: [value: string]; cancel: [] }>()

const draft = ref(value)
const input = useTemplateRef<HTMLInputElement>('input')
let settled = false
/** Where focus was before editing, so a keyboard finish can return it. */
let returnFocusTo: HTMLElement | null = null

watch(
  () => editing,
  async (on) => {
    if (!on) return
    draft.value = value
    settled = false
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    input.value?.focus()
    input.value?.select()
  },
  { immediate: true }
)

function commit(): void {
  if (settled) return
  settled = true
  const next = draft.value.trim()
  if (next && next !== value) emit('commit', next)
  else emit('cancel')
}

function cancel(): void {
  if (settled) return
  settled = true
  emit('cancel')
}

function finishFromKeyboard(finish: () => void): void {
  finish()
  if (returnFocusTo?.isConnected) returnFocusTo.focus()
}
</script>

<template>
  <input
    v-if="editing"
    ref="input"
    v-model="draft"
    :aria-label="label"
    spellcheck="false"
    :class="
      cn(
        '-mx-1 w-full min-w-0 rounded-min bg-secondary-background px-1 text-inherit outline-none [font:inherit]',
        'ring-1 ring-border-focus',
        className
      )
    "
    @keydown.enter.prevent.stop="finishFromKeyboard(commit)"
    @keydown.esc.prevent.stop="finishFromKeyboard(cancel)"
    @blur="commit"
    @click.stop
    @dblclick.stop
    @keydown.space.stop
  />
  <slot v-else />
</template>
