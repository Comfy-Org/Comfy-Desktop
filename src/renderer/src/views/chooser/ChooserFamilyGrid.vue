<script setup lang="ts">
import { computed } from 'vue'
import ChooserInstallTile from './ChooserInstallTile.vue'
import { homeBuildTones } from '../../panel/home/homeBuild'
import { useInstallationStore } from '../../stores/installationStore'
import type { Installation } from '../../types/ipc'

const props = withDefaults(
  defineProps<{
    installations: Installation[]
    showFreeRunsPill?: boolean
    showWhyCloud?: boolean
    isStoppedActionGated: (inst: Installation) => boolean
    isPromotingToWorkspace?: (inst: Installation) => boolean
  }>(),
  {
    showFreeRunsPill: false,
    showWhyCloud: false,
    isPromotingToWorkspace: () => false
  }
)

const emit = defineEmits<{
  pick: [installation: Installation]
  'open-details': [installation: Installation]
  'open-card-menu': [event: MouseEvent, installation: Installation]
  'open-kebab-menu': [event: MouseEvent, installation: Installation]
  'trigger-action': [action: 'update' | 'migrate', installation: Installation]
  'view-error': [installation: Installation]
  'view-danger': [installation: Installation]
  'why-cloud': []
}>()

const installationStore = useInstallationStore()
const tones = computed(() => homeBuildTones(props.installations, installationStore.installations))

function lockLeavingTileSize(el: Element): void {
  const node = el as HTMLElement
  const grid = node.parentElement
  if (!grid) return
  const rect = node.getBoundingClientRect()
  const gridRect = grid.getBoundingClientRect()
  node.style.width = `${rect.width}px`
  node.style.height = `${rect.height}px`
  node.style.left = `${rect.left - gridRect.left + grid.scrollLeft}px`
  node.style.top = `${rect.top - gridRect.top + grid.scrollTop}px`
}

function unlockTileSize(el: Element): void {
  const node = el as HTMLElement
  node.style.removeProperty('width')
  node.style.removeProperty('height')
  node.style.removeProperty('left')
  node.style.removeProperty('top')
}
</script>

<template>
  <TransitionGroup
    tag="div"
    name="tile"
    enter-active-class="tile-enter-active [transition:opacity_200ms_ease,transform_200ms_cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:duration-[1ms]"
    enter-from-class="tile-enter-from opacity-0 [transform:translateY(8px)_scale(0.98)] motion-reduce:transform-none"
    leave-active-class="tile-leave-active absolute [transition:opacity_140ms_ease,transform_140ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-[1ms]"
    leave-to-class="tile-leave-to opacity-0 [transform:scale(0.98)] motion-reduce:transform-none"
    move-class="tile-move [transition:transform_220ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-[1ms]"
    class="chooser-family-grid relative grid w-full grid-cols-2 gap-[15px]"
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
      :is-stopped-action-gated="props.isStoppedActionGated(installation)"
      :is-promoting-to-workspace="props.isPromotingToWorkspace(installation)"
      @why-cloud="emit('why-cloud')"
      @pick="emit('pick', $event)"
      @open-details="emit('open-details', $event)"
      @open-card-menu="(event, inst) => emit('open-card-menu', event, inst)"
      @open-kebab-menu="(event, inst) => emit('open-kebab-menu', event, inst)"
      @trigger-action="(action, inst) => emit('trigger-action', action, inst)"
      @view-error="emit('view-error', $event)"
      @view-danger="emit('view-danger', $event)"
    />
  </TransitionGroup>
</template>
