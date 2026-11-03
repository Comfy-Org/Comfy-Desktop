<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown, Play, Plus, Rocket } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../ui/Button.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import { activeInstance, deployEnv, hostActions, instances, proto } from '../useProto'
import { can } from '../milestones'
import { onCloud } from './shell/surface'

/** One Create button, top right; what used to be separate buttons (open
 *  ComfyUI, deploy) are its menu. Deploy shows once the Builder exists and
 *  there is a local build to deploy (not in a browser, which can't reach
 *  one). With only one option there is no menu: the button does it. */
const deployable = computed(
  () =>
    !onCloud.value &&
    can.value.builder &&
    proto.signedIn &&
    instances.value.find((i) => !i.deployment && i.kind === 'local')
)

// In a browser (Comfy Cloud) ComfyUI opens on a cloud build.
const target = computed(() =>
  onCloud.value
    ? (instances.value.find((i) => i.kind === 'cloud') ?? activeInstance.value)
    : activeInstance.value
)

function deploy(): void {
  const target = activeInstance.value.kind === 'local' ? activeInstance.value : deployable.value
  if (target) deployEnv(target.id)
}
</script>

<template>
  <Button v-if="!deployable" variant="primary" class="gap-1.5" @click="hostActions.launch(target)">
    <Play :size="14" />{{ onCloud ? 'Open ComfyUI ↗' : 'Open ComfyUI' }}
  </Button>
  <DropdownMenuRoot v-else :modal="false">
    <DropdownMenuTrigger as-child>
      <Button variant="primary" class="group gap-1.5 pr-2">
        <Plus :size="14" />Create
        <ChevronDown
          :size="14"
          class="text-inverted-foreground/60 transition-transform duration-150 group-data-[state=open]:rotate-180"
        />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-64">
      <DropdownMenuItem @select="hostActions.launch(target)">
        <Play :size="14" />
        <span class="flex-1 whitespace-nowrap">{{
          onCloud ? 'Open ComfyUI ↗' : 'Open ComfyUI'
        }}</span>
        <span class="text-subtle-foreground">{{ target.name }}</span>
      </DropdownMenuItem>
      <DropdownMenuItem v-if="deployable" @select="deploy">
        <Rocket :size="14" />Deploy as an API
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>
