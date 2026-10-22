<script setup lang="ts">
import {
  ArrowDownToLine,
  EllipsisVertical,
  FolderOpen,
  Settings2,
  Square,
  Terminal,
  Trash2
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../ui/Button.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import DropdownMenuSeparator from '../ui/DropdownMenuSeparator.vue'
import { toast } from '../useProto'
import type { ProtoInstance } from '../mock'

/** Per-instance overflow menu (cards, list rows). */
const { inst } = defineProps<{ inst: ProtoInstance }>()
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" :aria-label="`${inst.name} options`" @click.stop>
        <EllipsisVertical :size="14" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-48">
      <DropdownMenuItem @select="toast(`${inst.name} settings`)"
        ><Settings2 :size="14" />Settings</DropdownMenuItem
      >
      <template v-if="inst.kind === 'local'">
        <DropdownMenuItem @select="toast('Opening folder…')"
          ><FolderOpen :size="14" />Show in Finder</DropdownMenuItem
        >
        <DropdownMenuItem @select="toast('Console')"
          ><Terminal :size="14" />Console</DropdownMenuItem
        >
        <DropdownMenuItem v-if="inst.state === 'update'" @select="toast('Updating…')">
          <ArrowDownToLine :size="14" />Update
        </DropdownMenuItem>
      </template>
      <DropdownMenuItem v-if="inst.state === 'running'" @select="toast(`Stopping ${inst.name}…`)">
        <Square :size="13" />Stop
      </DropdownMenuItem>
      <template v-if="inst.kind === 'local' || inst.deployment">
        <DropdownMenuSeparator />
        <DropdownMenuItem @select="toast(`Delete ${inst.name}`)"
          ><Trash2 :size="14" />Delete…</DropdownMenuItem
        >
      </template>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>
