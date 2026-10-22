<script setup lang="ts">
import { ref } from 'vue'
import { Copy, EllipsisVertical, Pencil, Share2, Trash2 } from 'lucide-vue-next'
import {
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  DropdownMenuRoot,
  DropdownMenuSub,
  DropdownMenuTrigger,
  PopoverRoot,
  PopoverTrigger
} from 'reka-ui'
import Button from '../../landing/ui/Button.vue'
import DialogContent from '../../landing/ui/DialogContent.vue'
import DropdownMenuCheckboxItem from '../../landing/ui/DropdownMenuCheckboxItem.vue'
import DropdownMenuContent from '../../landing/ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../landing/ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../landing/ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../../landing/ui/DropdownMenuSeparator.vue'
import DropdownMenuSubContent from '../../landing/ui/DropdownMenuSubContent.vue'
import DropdownMenuSubTrigger from '../../landing/ui/DropdownMenuSubTrigger.vue'
import PopoverContent from '../../landing/ui/PopoverContent.vue'
import Tooltip from '../../landing/ui/Tooltip.vue'
import GallerySection from '../parts/GallerySection.vue'
import Specimen from '../parts/Specimen.vue'
import VariantGroup from '../parts/VariantGroup.vue'
import { toast } from '../../landing/useProto'

const showHidden = ref(true)
const open = ref(false)
</script>

<template>
  <GallerySection
    id="overlays"
    title="Menus and overlays"
    description="Menu, popover and select share one floating surface: radius 12, padding 4, items radius 8."
  >
    <VariantGroup title="Floating" note="Menu, popover and tooltip share one surface." cell="md">
      <Specimen label="DropdownMenu">
        <DropdownMenuRoot :modal="false">
          <DropdownMenuTrigger as-child>
            <Button><EllipsisVertical :size="14" />Options</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Workflow</DropdownMenuLabel>
            <DropdownMenuItem @select="toast('Rename')"
              ><Pencil :size="14" />Rename</DropdownMenuItem
            >
            <DropdownMenuItem @select="toast('Duplicate')"
              ><Copy :size="14" />Duplicate</DropdownMenuItem
            >
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Share2 :size="14" />Share</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem @select="toast('Copy link')">Copy link</DropdownMenuItem>
                <DropdownMenuItem @select="toast('Invite')">Invite people</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuCheckboxItem v-model="showHidden">Show hidden</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled><Trash2 :size="14" />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </Specimen>

      <Specimen label="Popover">
        <PopoverRoot>
          <PopoverTrigger as-child><Button>Details</Button></PopoverTrigger>
          <PopoverContent class="w-64 p-4">
            <p class="text-ui font-medium">My Local 1</p>
            <p class="mt-1 text-ui text-muted-foreground">Stable · v0.37.4 · 12 nodes</p>
          </PopoverContent>
        </PopoverRoot>
      </Specimen>

      <Specimen label="Tooltip">
        <Tooltip content="Opens in ComfyUI"><Button variant="ghost">Hover me</Button></Tooltip>
      </Specimen>
    </VariantGroup>
    <VariantGroup title="Modal and feedback" cell="md">
      <Specimen label='Dialog · size="md"'>
        <DialogRoot v-model:open="open">
          <DialogTrigger as-child><Button>Open dialog</Button></DialogTrigger>
          <DialogContent size="md" class="p-6">
            <DialogTitle class="text-heading font-semibold">Delete workflow?</DialogTitle>
            <DialogDescription class="mt-1 text-ui text-muted-foreground">
              hero-shot-v4 is removed from this computer. This can't be undone.
            </DialogDescription>
            <div class="mt-6 flex justify-end gap-2">
              <Button variant="ghost" @click="open = false">Cancel</Button>
              <Button variant="destructive" @click="((open = false), toast('Deleted'))"
                >Delete</Button
              >
            </div>
          </DialogContent>
        </DialogRoot>
      </Specimen>

      <Specimen label="toast()">
        <Button @click="toast('Saved to Workflows')">Show toast</Button>
      </Specimen>
    </VariantGroup>
  </GallerySection>
</template>
