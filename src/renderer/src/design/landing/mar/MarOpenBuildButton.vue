<script setup lang="ts">
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from 'reka-ui'
import { Cloud, Laptop } from 'lucide-vue-next'
import LocationIcon from '../ui/LocationIcon.vue'
import Tooltip from '../ui/Tooltip.vue'
import { cn } from '../ui/cn'
import { menuItem } from '../ui/menu.styles'
import { envStatus } from '../parts/env/env'
import { hostActions, isUsable, recentInstances } from '../useProto'
import type { ProtoInstance } from '../mock'
import { errorOf } from './build/buildErrors'
import MarSplitButton from './pages/MarSplitButton.vue'

/**
 * Home's Open ComfyUI, as Desktop ships it (Comfy-Desktop#2030): the main
 * half opens ComfyUI in `target`, its mark says local or Cloud and the
 * tooltip names it; the chevron lists every build, most recent first. The
 * status is a dot on the mark (green live, red didn't start); the build
 * the main half opens fills its row. A build that can't open is greyed,
 * with the reason on hover. With one build it is a plain button.
 */
const { target } = defineProps<{ target: ProtoInstance }>()

const kind = (i: ProtoInstance): 'cloud' | 'local' => (i.kind === 'cloud' ? 'cloud' : 'local')
const blocked = (i: ProtoInstance): string | undefined =>
  isUsable(i) ? undefined : envStatus(i).label
const problem = (i: ProtoInstance): string | undefined =>
  blocked(i) ?? (errorOf(i.id) ? "Didn't start" : undefined)
const tone = (i: ProtoInstance): 'live' | 'danger' | undefined =>
  errorOf(i.id) ? 'danger' : envStatus(i).live ? 'live' : undefined
const row = cn(
  menuItem,
  // aria-checked, not data-state: the tooltip trigger takes data-state.
  // A greyed row still takes the pointer, so its reason shows on hover.
  'group w-full pr-5 aria-checked:bg-secondary-background-hover data-disabled:pointer-events-auto data-disabled:cursor-default'
)
</script>

<template>
  <MarSplitButton
    label="Open ComfyUI"
    :icon="target.kind === 'cloud' ? Cloud : Laptop"
    :tooltip="`Opens in ${target.name}`"
    menu-label="Choose the build to open"
    @run="hostActions.launch(target)"
  >
    <template v-if="recentInstances.length > 1" #menu>
      <DropdownMenuRadioGroup :model-value="target.id" class="flex flex-col gap-0.5">
        <Tooltip
          v-for="i in recentInstances"
          :key="i.id"
          :content="problem(i) ?? ''"
          :disabled="!problem(i)"
          side="left"
        >
          <DropdownMenuRadioItem
            :value="i.id"
            :disabled="blocked(i) !== undefined"
            :class="row"
            @select="hostActions.launch(i)"
          >
            <span class="relative flex shrink-0">
              <LocationIcon :kind="kind(i)" :size="14" />
              <span
                v-if="tone(i)"
                class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-card-background group-aria-checked:border-secondary-background-hover"
                :class="tone(i) === 'danger' ? 'bg-status-danger' : 'bg-status-running'"
                aria-hidden="true"
              />
            </span>
            <span class="min-w-0 flex-1 truncate text-left" :title="i.name">{{ i.name }}</span>
          </DropdownMenuRadioItem>
        </Tooltip>
      </DropdownMenuRadioGroup>
    </template>
  </MarSplitButton>
</template>
