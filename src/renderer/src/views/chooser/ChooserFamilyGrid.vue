<script setup lang="ts">
import { computed, onBeforeUpdate, useTemplateRef, type ComponentPublicInstance } from 'vue'
import ChooserInstallTile from './ChooserInstallTile.vue'
import { homeBuildTones } from '../../panel/home/homeBuild'
import { useInstallationStore } from '../../stores/installationStore'
import { useAutoStartBuild } from '../../composables/useAutoStartBuild'
import type { Installation } from '../../types/ipc'

const props = withDefaults(
  defineProps<{
    installations: Installation[]
    showFreeRunsPill?: boolean
    showWhyCloud?: boolean
  }>(),
  {
    showFreeRunsPill: false,
    showWhyCloud: false
  }
)

const emit = defineEmits<{
  pick: [installation: Installation]
  'open-details': [installation: Installation]
  'view-error': [installation: Installation]
  'view-danger': [installation: Installation]
  'why-cloud': []
}>()

const installationStore = useInstallationStore()
const tones = computed(() => homeBuildTones(props.installations, installationStore.installations))
const autoStart = useAutoStartBuild()

interface TileBox {
  left: number
  top: number
  width: number
  height: number
}

const grid = useTemplateRef<ComponentPublicInstance>('grid')
let boxesBeforeChange = new WeakMap<Element, TileBox>()

onBeforeUpdate(() => {
  const gridEl = grid.value?.$el
  if (!(gridEl instanceof HTMLElement)) return
  boxesBeforeChange = new WeakMap()
  for (const tile of gridEl.children) {
    if (!(tile instanceof HTMLElement)) continue
    boxesBeforeChange.set(tile, {
      left: tile.offsetLeft,
      top: tile.offsetTop,
      width: tile.offsetWidth,
      height: tile.offsetHeight
    })
  }
})

function lockLeavingTileSize(el: Element): void {
  const node = el as HTMLElement
  const box = boxesBeforeChange.get(node) ?? {
    left: node.offsetLeft,
    top: node.offsetTop,
    width: node.offsetWidth,
    height: node.offsetHeight
  }
  node.style.position = 'absolute'
  node.style.width = `${box.width}px`
  node.style.height = `${box.height}px`
  node.style.left = `${box.left}px`
  node.style.top = `${box.top}px`
}

function unlockTileSize(el: Element): void {
  const node = el as HTMLElement
  node.style.removeProperty('position')
  node.style.removeProperty('width')
  node.style.removeProperty('height')
  node.style.removeProperty('left')
  node.style.removeProperty('top')
}
</script>

<template>
  <div class="@container/builds w-full">
    <TransitionGroup
      ref="grid"
      tag="div"
      name="tile"
      enter-active-class="tile-enter-active [transition:opacity_200ms_ease,transform_200ms_cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:duration-[1ms]"
      enter-from-class="tile-enter-from opacity-0 [transform:translateY(8px)_scale(0.98)] motion-reduce:transform-none"
      leave-active-class="tile-leave-active [transition:opacity_140ms_ease,transform_140ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-[1ms]"
      leave-to-class="tile-leave-to opacity-0 [transform:scale(0.98)] motion-reduce:transform-none"
      move-class="tile-move [transition:transform_220ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-[1ms]"
      class="chooser-family-grid relative grid w-full grid-cols-2 gap-[15px] @max-[40rem]/builds:grid-cols-1"
      @before-leave="lockLeavingTileSize"
      @leave-cancelled="unlockTileSize"
    >
      <ChooserInstallTile
        v-for="(installation, index) in props.installations"
        :key="`install:${installation.id}`"
        :installation="installation"
        :tone="tones[index]"
        :show-free-runs-pill="props.showFreeRunsPill && installation.sourceCategory === 'cloud'"
        :show-why-cloud="props.showWhyCloud && installation.sourceCategory === 'cloud'"
        :auto-start="autoStart.startsOnOpen(installation.id)"
        @why-cloud="emit('why-cloud')"
        @pick="emit('pick', $event)"
        @open-details="emit('open-details', $event)"
        @view-error="emit('view-error', $event)"
        @view-danger="emit('view-danger', $event)"
      />
    </TransitionGroup>
  </div>
</template>
