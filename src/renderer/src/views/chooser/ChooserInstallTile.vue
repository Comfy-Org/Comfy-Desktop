<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { EllipsisVertical, Info, Play, SquareArrowOutUpRight } from 'lucide-vue-next'
import { useInstallTileState } from '../../composables/useInstallTileState'
import type { InstallLifecycleStatus } from '../../composables/useInstallTileState'
import Tooltip from '../../components/ui/Tooltip.vue'
import TruncatedText from '../../components/TruncatedText.vue'
import InstallBadges from '../../components/InstallBadges.vue'
import Button from '../../design-system/components/Button.vue'
import Card from '../../design-system/components/Card.vue'
import LocationIcon from '../../design-system/components/LocationIcon.vue'
import { TID } from '../../../../shared/testIds'
import type { Installation } from '../../types/ipc'

interface Props {
  installation: Installation
  showFreeRunsPill?: boolean
  showWhyCloud?: boolean
  /** Override runtime lifecycle presentation for surfaces that own separate sessions. */
  lifecycleStatus?: InstallLifecycleStatus
  /** True when REQUIRES_STOPPED actions (update / migrate / restore / delete) are gated. */
  isStoppedActionGated: boolean
  /** True while Desktop captures this instance and creates its workspace draft. */
  isPromotingToWorkspace?: boolean
  /** Hide the card's context/kebab menu while keeping inline action pills enabled. */
  showMenu?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  lifecycleStatus: undefined,
  showMenu: true
})

const emit = defineEmits<{
  pick: [installation: Installation]
  'open-card-menu': [event: MouseEvent, installation: Installation]
  'open-kebab-menu': [event: MouseEvent, installation: Installation]
  'trigger-action': [action: 'update' | 'migrate', installation: Installation]
  'view-error': [installation: Installation]
  'view-danger': [installation: Installation]
  'why-cloud': []
}>()

const { t } = useI18n()

const {
  inst,
  isRunning,
  isUpdating,
  statusClasses,
  showWhyCloudTrigger,
  typeMeta,
  leadingFact,
  trailingFact,
  metaLine,
  launchLabel,
  canLaunch
} = useInstallTileState({
  installation: () => props.installation,
  lifecycleStatus: () => props.lifecycleStatus,
  isPromotingToWorkspace: () => props.isPromotingToWorkspace,
  showWhyCloud: () => props.showWhyCloud
})

function handleClick(): void {
  if (!canLaunch.value) return
  emit('pick', inst.value)
}

function handleContextMenu(event: MouseEvent): void {
  if (!props.showMenu || isUpdating.value) return
  emit('open-card-menu', event, inst.value)
}
</script>

<template>
  <Card
    variant="elevated"
    padding="md"
    interactive
    role="button"
    :tabindex="isUpdating ? -1 : 0"
    :aria-disabled="isUpdating || undefined"
    class="chooser-tile chooser-tile--install group flex min-w-0 flex-col gap-3.5"
    :class="statusClasses"
    :data-testid="TID.dashboardTile(inst.id)"
    :data-source-category="inst.sourceCategory"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
    @contextmenu.prevent="handleContextMenu"
  >
    <div class="flex items-start justify-between gap-2">
      <!-- Where it runs; the install type is in the meta line and the tooltip. -->
      <span class="chooser-tile-icon inline-flex" :title="t(typeMeta.labelKey)">
        <LocationIcon :kind="inst.sourceCategory === 'cloud' ? 'cloud' : 'local'" :size="28" />
      </span>

      <!-- Lifecycle indicator, update / migrate action and kebab. Status pill is
         click-through; error badge opens details. -->
      <div class="chooser-tile-actions flex min-w-0 items-center gap-1">
        <InstallBadges
          :installation="inst"
          :show-free-runs-pill="props.showFreeRunsPill"
          :is-stopped-action-gated="props.isStoppedActionGated"
          :is-promoting-to-workspace="props.isPromotingToWorkspace"
          :lifecycle-status="props.lifecycleStatus"
          show-status
          @view-error="emit('view-error', $event)"
          @view-danger="emit('view-danger', $event)"
          @trigger-action="(action, target) => emit('trigger-action', action, target)"
        />
        <Button
          v-if="props.showMenu && !isUpdating"
          variant="ghost"
          size="icon-sm"
          class="chooser-tile-kebab"
          :title="t('chooser.moreActions')"
          :aria-label="t('chooser.moreActions')"
          :data-testid="TID.dashboardTileKebab(inst.id)"
          @click.stop="emit('open-kebab-menu', $event, inst)"
          @contextmenu.stop="emit('open-kebab-menu', $event, inst)"
          @keydown.enter.stop
          @keydown.space.stop
        >
          <EllipsisVertical :size="14" />
        </Button>
      </div>
    </div>

    <!-- Name, then the meta facts. -->
    <div class="chooser-tile-body min-w-0">
      <div class="chooser-tile-name-row flex min-w-0 items-center gap-1.5">
        <TruncatedText
          class="chooser-tile-name min-w-0 text-heading font-semibold"
          :text="inst.name"
        />
        <Tooltip v-if="showWhyCloudTrigger" :text="t('firstUse.whyTryCloud')">
          <Button
            variant="ghost"
            size="icon-xs"
            class="chooser-tile-why-cloud"
            :aria-label="t('firstUse.whyTryCloud')"
            :data-testid="TID.dashboardTileWhyCloud(inst.id)"
            @click.stop="emit('why-cloud')"
            @keydown.enter.stop
            @keydown.space.stop
          >
            <Info :size="14" />
          </Button>
        </Tooltip>
      </div>
      <TruncatedText
        v-if="metaLine"
        class="chooser-tile-meta-line text-ui text-muted-foreground"
        :text="metaLine"
      >
        <span v-if="leadingFact" class="chooser-tile-meta-source">{{ leadingFact }}</span>
        <span v-if="leadingFact && trailingFact" class="chooser-tile-meta-sep"> · </span>
        <span v-if="trailingFact" class="chooser-tile-meta-version">{{ trailingFact }}</span>
      </TruncatedText>
    </div>

    <!-- Launch on hover; the tile itself launches on click too. -->
    <div class="chooser-tile-footer mt-auto flex min-h-7 items-center justify-end">
      <Button
        v-if="canLaunch"
        size="sm"
        tabindex="-1"
        class="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        @click.stop="handleClick"
      >
        <SquareArrowOutUpRight v-if="isRunning" :size="12" />
        <Play v-else :size="12" />
        {{ launchLabel }}
      </Button>
    </div>
  </Card>
</template>
