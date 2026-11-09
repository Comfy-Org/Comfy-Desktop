<script setup lang="ts">
import { ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import LocationIcon from '../../ui/LocationIcon.vue'
import { cn } from '../../ui/cn'
import { fieldVariants } from '../../ui/field.variants'
import { floatingSurface, menuItem } from '../../ui/menu.styles'
import { PORTAL_TO } from '../../ui/portal'
import MarStatus from '../pages/MarStatus.vue'
import { assetBuilds, buildStatus, type AssetBuild } from './assetBuilds'

/** Whose assets (Assets, Phase 2): one build at a time, each with its
 *  state. A stopped build stays on the list; picking it shows a page that
 *  offers to start it, nothing starts on its own. */
const model = defineModel<string>({ required: true })
const open = ref(false)
const current = (): AssetBuild | undefined => assetBuilds.value.find((b) => b.id === model.value)
function pick(id: string): void {
  model.value = id
  open.value = false
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            fieldVariants({}),
            'w-auto max-w-64 cursor-pointer gap-2 pr-2 outline-none focus-visible:border-border-focus data-[state=open]:border-border-strong'
          )
        "
        aria-label="Build"
      >
        <LocationIcon
          v-if="current()"
          :kind="current()!.kind === 'cloud' ? 'cloud' : 'local'"
          :size="14"
          class="shrink-0 text-subtle-foreground"
        />
        <span class="truncate">{{ current()?.name ?? 'Pick a build' }}</span>
        <ChevronDown :size="13" class="ml-auto shrink-0 text-subtle-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverPortal :to="PORTAL_TO">
      <PopoverContent
        align="start"
        :side-offset="6"
        :class="cn(floatingSurface, 'flex w-72 flex-col')"
        role="listbox"
        aria-label="Builds"
      >
        <p class="px-2.5 pt-1.5 pb-1 text-ui text-subtle-foreground">Browse the assets of</p>
        <button
          v-for="b in assetBuilds"
          :key="b.id"
          type="button"
          role="option"
          :aria-selected="b.id === model"
          :class="cn(menuItem, 'w-full text-left hover:bg-secondary-background')"
          @click="pick(b.id)"
        >
          <LocationIcon :kind="b.kind === 'cloud' ? 'cloud' : 'local'" :size="14" />
          <span class="min-w-0 flex-1 truncate">{{ b.name }}</span>
          <MarStatus :status="buildStatus(b)" class="shrink-0" />
          <span class="flex w-4 shrink-0 justify-end text-muted-foreground"
            ><Check v-if="b.id === model" :size="13"
          /></span>
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
