<script setup lang="ts">
import { ClipboardCopy } from 'lucide-vue-next'
import Button from '../../landing/ui/Button.vue'
import Tooltip from '../../landing/ui/Tooltip.vue'
import { toast } from '../../landing/useProto'

/** Copies a precise description of a component or token (reference.ts),
 *  to paste into an LLM along with what you want done with it. */
const { what, text } = defineProps<{ what: string; text: () => string }>()
async function copy(): Promise<void> {
  await navigator.clipboard.writeText(text())
  toast(`Copied ${what} - paste it into your LLM`)
}
</script>

<template>
  <!-- A real root element, so a positioning class from the parent applies. -->
  <span class="inline-flex">
    <Tooltip :content="`Copy ${what} for your LLM: files, variants, tokens and where it's used`">
      <Button variant="ghost" size="icon-sm" :aria-label="`Copy ${what} reference`" @click="copy"
        ><ClipboardCopy :size="14"
      /></Button>
    </Tooltip>
  </span>
</template>
