<script setup lang="ts">
import { computed } from 'vue'
import { Cloud, CloudCheck, Folder, FolderSearch } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../ui/Button.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../ui/DropdownMenuSeparator.vue'
import Tooltip from '../ui/Tooltip.vue'
import { downloads, localFolders, type GalleryAsset } from '../gallery'
import { instanceById, toast } from '../useProto'

/** Cloud badge on a gallery tile. Click to download the asset into one of
 *  the local folders; once downloaded it shows where it went. */
const { asset } = defineProps<{ asset: GalleryAsset }>()

const savedTo = computed(() => {
  const id = downloads.get(asset.id)
  return id ? localFolders.value.find((f) => f.id === id) : undefined
})
const folderLabel = (f: { name: string; instanceId?: string }): string =>
  f.instanceId ? `${instanceById(f.instanceId)?.name} / ${f.name}` : f.name

function save(folderId: string): void {
  downloads.set(asset.id, folderId)
  const f = localFolders.value.find((x) => x.id === folderId)
  toast(`Downloading ${asset.name} to ${f ? folderLabel(f) : 'folder'}`)
}
</script>

<template>
  <Tooltip
    wrap
    :content="savedTo ? `On this computer · ${folderLabel(savedTo)}` : 'On Comfy Cloud · Download'"
  >
    <DropdownMenuRoot :modal="false">
      <DropdownMenuTrigger as-child>
        <Button
          variant="overlay"
          size="icon-xs"
          :aria-label="savedTo ? 'Downloaded' : 'Download from Comfy Cloud'"
          @click.stop
        >
          <CloudCheck v-if="savedTo" :size="13" />
          <Cloud v-else :size="13" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-72">
        <DropdownMenuLabel>Download to</DropdownMenuLabel>
        <DropdownMenuItem v-for="f in localFolders" :key="f.id" @select="save(f.id)">
          <Folder :size="14" />
          <span class="flex min-w-0 flex-col">
            <span>{{ folderLabel(f) }}</span>
            <span class="truncate font-mono text-ui text-subtle-foreground">{{ f.path }}</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem @select="toast('Choose a folder…')"
          ><FolderSearch :size="14" />Choose another folder…</DropdownMenuItem
        >
      </DropdownMenuContent>
    </DropdownMenuRoot>
  </Tooltip>
</template>
