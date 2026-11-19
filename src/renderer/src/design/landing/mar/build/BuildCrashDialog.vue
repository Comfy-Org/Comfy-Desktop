<script setup lang="ts">
import { computed } from 'vue'
import { Copy, Play, SquareTerminal } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { openBuild } from './buildTab'

/**
 * The Error chip's details (ChooserInstallTile's "View error details"):
 * what went wrong, the last lines ComfyUI printed, and the ways on - the
 * Terminal, a copy for a bug report, or starting again.
 */
const { build } = defineProps<{ build?: ProtoInstance & { error?: string } }>()
const emit = defineEmits<{ close: []; start: [] }>()
const open = computed({
  get: () => Boolean(build),
  set: (v) => !v && emit('close')
})
const LOG = [
  'Import times for custom nodes:',
  '   0.0 seconds: custom_nodes/websocket_image_save.py',
  '   0.4 seconds (IMPORT FAILED): custom_nodes/ComfyUI-Flux-Tools',
  'Traceback (most recent call last):',
  '  File "nodes.py", line 2131, in load_custom_node',
  "ModuleNotFoundError: No module named 'diffusers.pipelines.flux'",
  'Process exited with code 1'
]
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent size="lg" class="mar-crash">
      <div class="flex flex-col gap-1 px-6 pt-6">
        <DialogTitle class="m-0 text-[15px] font-semibold"
          >{{ build?.name }} stopped with an error</DialogTitle
        >
        <DialogDescription class="m-0 text-ui text-muted-foreground">{{
          build?.error
        }}</DialogDescription>
      </div>
      <pre class="mar-crash-log">{{ LOG.join('\n') }}</pre>
      <div class="flex items-center gap-2 px-6 pb-6">
        <Button variant="ghost" @click="toast('Error details copied')"
          ><Copy :size="14" />Copy details</Button
        >
        <Button variant="ghost" @click="build && (openBuild(build.id, 'terminal'), emit('close'))"
          ><SquareTerminal :size="14" />Open Terminal</Button
        >
        <Button class="ml-auto" variant="primary" @click="(emit('start'), emit('close'))"
          ><Play :size="14" />Start again</Button
        >
      </div>
    </DialogContent>
  </DialogRoot>
</template>

<style>
.mar-crash-log {
  max-height: 240px;
  margin: 16px 24px;
  overflow: auto;
  padding: 12px 14px;
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  color: var(--color-muted-foreground);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 18px;
  white-space: pre;
}
</style>
