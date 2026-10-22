<script setup lang="ts">
import { computed } from 'vue'
import Badge from '../ui/Badge.vue'
import LocationIcon from '../ui/LocationIcon.vue'
import MediaCard from '../ui/MediaCard.vue'
import Tooltip from '../ui/Tooltip.vue'
import GraphPreview from './GraphPreview.vue'
import DeployedTo from './space/DeployedTo.vue'
import { openDeploy } from '../spaces'
import type { ProjectWorkflow } from '../gallery'
import { INSTANCES } from '../mock'
import { EllipsisVertical, Play, Rocket } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../ui/Button.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import { deployEnv, hostActions, instanceById, proto } from '../useProto'

/** A workflow: graph thumbnail, name, when, where it runs, version. Opening
 *  it launches ComfyUI from the environment it belongs to. */
const { wf } = defineProps<{ wf: ProjectWorkflow }>()

const target = computed(() =>
  wf.envId
    ? instanceById(wf.envId)
    : wf.source === 'cloud'
      ? INSTANCES.find((i) => i.id === 'cloud')
      : undefined
)
const where = computed(
  () => target.value?.name ?? (wf.source === 'cloud' ? 'Comfy Cloud' : 'This computer')
)
/** Vary framing per workflow so a grid of graphs doesn't look cloned. */
const zoom = computed(
  () => 0.26 + ([...wf.name].reduce((n, c) => n + c.charCodeAt(0), 0) % 5) * 0.025
)
/** Bridge to Build: deploy the environment this workflow lives in. */
const canDeploy = computed(
  () =>
    proto.signedIn &&
    Boolean(target.value && !(target.value.kind === 'cloud' && !target.value.deployment))
)
function open(): void {
  if (target.value) hostActions.launch(target.value, wf.name)
}
</script>

<template>
  <MediaCard
    ratio="16/10"
    :aria-label="`${wf.name}, opens in ${where}`"
    @click="open"
    @dblclick="open"
    @keydown.enter="open"
  >
    <template v-if="canDeploy || proto.spaces" #top-right>
      <DropdownMenuRoot :modal="false">
        <DropdownMenuTrigger as-child>
          <Button
            variant="overlay"
            size="icon-xs"
            aria-label="Workflow options"
            class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            @click.stop
          >
            <EllipsisVertical :size="13" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-52">
          <DropdownMenuItem @select="open"><Play :size="14" />Open in {{ where }}</DropdownMenuItem>
          <DropdownMenuItem
            v-if="proto.spaces"
            @select="openDeploy({ kind: 'workflow', name: wf.name, thumbId: wf.thumbId })"
            ><Rocket :size="14" />Deploy…</DropdownMenuItem
          >
          <DropdownMenuItem v-else @select="deployEnv(target!.id)"
            ><Rocket :size="14" />Deploy as API</DropdownMenuItem
          >
        </DropdownMenuContent>
      </DropdownMenuRoot>
    </template>
    <template #media>
      <GraphPreview
        :thumb-id="wf.thumbId"
        :category="wf.category"
        :zoom
        class="transition-transform duration-500 group-hover:scale-[1.03]"
      />
    </template>
    <div class="flex items-center gap-2">
      <p class="min-w-0 flex-1 truncate text-ui font-semibold">{{ wf.name }}</p>
      <Tooltip :content="`Opens in ${where}`">
        <span class="inline-flex"><LocationIcon :kind="wf.source" :size="16" /></span>
      </Tooltip>
    </div>
    <div class="mt-1 flex h-5 items-center justify-between gap-2 text-ui text-subtle-foreground">
      <span class="truncate">{{ wf.modified }} · {{ where }}</span>
      <Badge v-if="wf.version" size="md" class="tabular-nums">v{{ wf.version }}</Badge>
    </div>
    <!-- Spaces: where this workflow is deployed. -->
    <div v-if="proto.spaces" class="mt-2.5 border-t border-border-default pt-2.5">
      <DeployedTo kind="workflow" :name="wf.name" />
    </div>
  </MediaCard>
</template>
