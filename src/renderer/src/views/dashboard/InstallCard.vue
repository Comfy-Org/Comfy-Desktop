<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { EllipsisVertical, Info, Play, SquareArrowOutUpRight } from 'lucide-vue-next'
import Button from '../../design-system/components/Button.vue'
import Card from '../../design-system/components/Card.vue'
import InlineEdit from '../../design-system/components/InlineEdit.vue'
import LocationIcon from '../../design-system/components/LocationIcon.vue'
import StatusDot from '../../design-system/components/StatusDot.vue'
import Tooltip from '../../design-system/components/Tooltip.vue'
import InstallBadges from '../../components/InstallBadges.vue'
import { useBuildStatus } from './installStatus'
import { injectBuildRename } from './useBuildRename'
import { useInstallTileState } from '../../composables/useInstallTileState'
import type { Installation } from '../../types/ipc'

/** A build on the All builds page: where it runs (its icon) and its state;
 *  the card opens the build's page, its button starts or opens ComfyUI. */
const props = defineProps<{
  installation: Installation
  showFreeRunsPill?: boolean
  showWhyCloud?: boolean
  isStoppedActionGated: boolean
  isPromotingToWorkspace?: boolean
}>()

const emit = defineEmits<{
  open: [installation: Installation]
  launch: [installation: Installation]
  'open-card-menu': [event: MouseEvent, installation: Installation]
  'open-kebab-menu': [event: MouseEvent, installation: Installation]
  'trigger-action': [action: 'update' | 'migrate', installation: Installation]
  'view-error': [installation: Installation]
  'view-danger': [installation: Installation]
  'why-cloud': []
}>()

const { t } = useI18n()
const tile = useInstallTileState({
  installation: () => props.installation,
  isPromotingToWorkspace: () => props.isPromotingToWorkspace,
  showWhyCloud: () => props.showWhyCloud
})
const { inst, isRunning, isUpdating, showWhyCloudTrigger, metaLine, canLaunch } = tile
const { statusLabel, dotStatus } = useBuildStatus(tile)
const { isRenaming, commitRename, cancelRename } = injectBuildRename()

function open(): void {
  emit('open', inst.value)
}
</script>

<template>
  <Card
    padding="md"
    interactive
    role="button"
    tabindex="0"
    class="group flex min-w-0 flex-col gap-3"
    :data-testid="`dashboard-card-${inst.id}`"
    @click="open"
    @keydown.enter="open"
    @keydown.space.prevent="open"
    @contextmenu.prevent="!isUpdating && emit('open-card-menu', $event, inst)"
  >
    <div class="flex items-center gap-3">
      <LocationIcon :kind="inst.sourceCategory === 'cloud' ? 'cloud' : 'local'" :size="28" />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-1.5">
          <InlineEdit
            :value="inst.name"
            :editing="isRenaming(inst, 'main')"
            :label="t('buildsDashboard.rename.label')"
            class="text-heading font-semibold"
            @commit="commitRename(inst, $event)"
            @cancel="cancelRename"
          >
            <p class="truncate text-heading font-semibold">{{ inst.name }}</p>
          </InlineEdit>
          <Tooltip v-if="showWhyCloudTrigger" :content="t('firstUse.whyTryCloud')">
            <Button
              variant="ghost"
              size="icon-xs"
              :aria-label="t('firstUse.whyTryCloud')"
              @click.stop="emit('why-cloud')"
              @keydown.enter.stop
              @keydown.space.stop
            >
              <Info :size="14" />
            </Button>
          </Tooltip>
        </div>
        <p class="flex min-w-0 items-center gap-1.5 text-ui text-muted-foreground">
          <StatusDot :status="dotStatus" /><span class="shrink-0">{{ statusLabel }}</span>
          <span v-if="metaLine" class="truncate text-subtle-foreground">· {{ metaLine }}</span>
        </p>
      </div>
      <div class="shrink-0 self-start">
        <Button
          v-if="!isUpdating"
          variant="ghost"
          size="icon-sm"
          :aria-label="t('chooser.moreActions')"
          :data-testid="`dashboard-card-kebab-${inst.id}`"
          @click.stop="emit('open-kebab-menu', $event, inst)"
          @keydown.enter.stop
          @keydown.space.stop
        >
          <EllipsisVertical :size="14" />
        </Button>
      </div>
    </div>

    <div class="mt-auto flex min-h-7 items-center gap-2 border-t border-border-default pt-3">
      <InstallBadges
        :installation="inst"
        :show-free-runs-pill="showFreeRunsPill"
        :is-stopped-action-gated="isStoppedActionGated"
        :is-promoting-to-workspace="isPromotingToWorkspace"
        @view-error="emit('view-error', $event)"
        @view-danger="emit('view-danger', $event)"
        @trigger-action="(action, target) => emit('trigger-action', action, target)"
      />
      <Button
        variant="secondary"
        size="sm"
        class="ml-auto"
        :disabled="!canLaunch"
        :data-testid="`dashboard-card-launch-${inst.id}`"
        @click.stop="emit('launch', inst)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <SquareArrowOutUpRight v-if="isRunning" :size="13" />
        <Play v-else :size="13" />
        {{ isRunning ? t('buildsDashboard.openComfy') : t('buildsDashboard.startComfy') }}
      </Button>
    </div>
  </Card>
</template>
