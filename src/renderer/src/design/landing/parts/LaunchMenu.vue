<script setup lang="ts">
import { ChevronDown, Play } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../ui/Button.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import InstanceMenuItems from './InstanceMenuItems.vue'
import { hostActions } from '../useProto'
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child>
      <Button variant="primary" size="lg" class="group gap-2 pr-2.5 shadow-elev">
        <Play :size="14" />Launch ComfyUI
        <span class="ml-0.5 flex h-4 items-center border-l border-black/15 pl-1.5">
          <ChevronDown
            :size="15"
            class="transition-transform duration-150 group-data-[state=open]:rotate-180"
          />
        </span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-80">
      <InstanceMenuItems
        mode="launch"
        label="Launch ComfyUI from"
        @choose="(i) => hostActions.launch(i)"
      />
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>
