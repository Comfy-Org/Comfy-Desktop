<script setup lang="ts">
import { ref } from 'vue'
import { FolderPlus, Folders } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuCheckboxItem from '../ui/DropdownMenuCheckboxItem.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../ui/DropdownMenuSeparator.vue'
import { cn } from '../ui/cn'
import { fieldVariants } from '../ui/field.variants'
import AddFolderDialog from './AddFolderDialog.vue'
import { instanceById } from '../useProto'
import type { LocalFolder } from '../mock'

/** "Folders" filter: which local folders feed the view, plus Add a folder.
 *  `hidden` holds the folder ids the user unticked. Shared by Assets and
 *  project workflows. */
const { folders, label, suggestion } = defineProps<{
  folders: LocalFolder[]
  label: string
  suggestion: string
}>()
const hidden = defineModel<Set<string>>('hidden', { required: true })
const emit = defineEmits<{ add: [path: string] }>()
const adding = ref(false)

function toggle(id: string, show: boolean): void {
  const next = new Set(hidden.value)
  if (show) next.delete(id)
  else next.add(id)
  hidden.value = next
}
const folderName = (f: LocalFolder): string =>
  f.instanceId ? `${instanceById(f.instanceId)?.name} / ${f.name}` : f.name
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger
      :class="
        cn(
          fieldVariants(),
          'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-border-focus/30 data-[state=open]:border-border-strong'
        )
      "
    >
      <Folders :size="14" class="text-subtle-foreground" />
      Folders
      <span v-if="hidden.size" class="text-subtle-foreground tabular-nums">
        {{ folders.length - hidden.size }}/{{ folders.length }}
      </span>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-80">
      <DropdownMenuLabel>{{ label }}</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        v-for="f in folders"
        :key="f.id"
        :model-value="!hidden.has(f.id)"
        @update:model-value="(v: boolean) => toggle(f.id, v)"
      >
        <span class="flex min-w-0 flex-col">
          <span>{{ folderName(f) }}</span>
          <span class="truncate font-mono text-ui text-subtle-foreground">{{ f.path }}</span>
        </span>
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="adding = true"
        ><FolderPlus :size="14" />Add a folder…</DropdownMenuItem
      >
    </DropdownMenuContent>
  </DropdownMenuRoot>
  <AddFolderDialog v-model:open="adding" :suggestion @add="(p) => emit('add', p)" />
</template>
