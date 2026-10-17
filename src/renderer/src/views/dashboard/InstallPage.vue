<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronLeft,
  EllipsisVertical,
  Play,
  Server,
  Square,
  SquareArrowOutUpRight
} from 'lucide-vue-next'
import Badge from '../../design-system/components/Badge.vue'
import Button from '../../design-system/components/Button.vue'
import LocationIcon from '../../design-system/components/LocationIcon.vue'
import StatusDot from '../../design-system/components/StatusDot.vue'
import EmptyState from '../../design-system/components/EmptyState.vue'
import Tabs from '../../design-system/components/Tabs.vue'
import WorkflowsTab from './WorkflowsTab.vue'
import ModelsTab from './ModelsTab.vue'
import NodesTab from './NodesTab.vue'
import InstallBadges from '../../components/InstallBadges.vue'
import Tooltip from '../../design-system/components/Tooltip.vue'
import InlineEdit from '../../design-system/components/InlineEdit.vue'
import { buildInfoLines, useBuildStatus } from './installStatus'
import { injectBuildRename } from './useBuildRename'
import { formatRelativeFromMs } from '../../lib/datetime'
import { useInstallTileState } from '../../composables/useInstallTileState'
import type { Installation } from '../../types/ipc'

/** One build's page: what it is, where it runs, and its state, with the way
 *  into ComfyUI. Its contents (workflows, models, nodes, assets) are tabs. */
const props = defineProps<{
  installation: Installation
  isStoppedActionGated: boolean
  isPromotingToWorkspace?: boolean
}>()

const emit = defineEmits<{
  back: []
  launch: [installation: Installation]
  stop: [installation: Installation]
  'open-kebab-menu': [event: MouseEvent, installation: Installation]
  'trigger-action': [action: 'update' | 'migrate', installation: Installation]
  'view-error': [installation: Installation]
  'view-danger': [installation: Installation]
}>()

const { t } = useI18n()
const tile = useInstallTileState({
  installation: () => props.installation,
  isPromotingToWorkspace: () => props.isPromotingToWorkspace
})
const { inst, isRunning, isStopping, isUpdating, typeMeta, metaLine, canLaunch } = tile
const { statusLabel, dotStatus } = useBuildStatus(tile)
const { canRename, startRename, isRenaming, commitRename, cancelRename } = injectBuildRename()
const buildInfo = computed(() =>
  buildInfoLines(
    inst.value,
    {
      metaLine: metaLine.value,
      lastUsed: inst.value.lastLaunchedAt ? formatRelativeFromMs(inst.value.lastLaunchedAt, t) : ''
    },
    t
  ).join('\n')
)

type Tab = 'workflows' | 'models' | 'nodes'
const tab = ref<Tab>('workflows')
const tabs = computed(() => [
  { value: 'workflows' as const, label: t('buildsDashboard.tabs.workflows') },
  { value: 'models' as const, label: t('buildsDashboard.tabs.models') },
  { value: 'nodes' as const, label: t('buildsDashboard.tabs.nodes') }
])

/** Only a local build has a process here to stop. */
const canStop = computed(
  () => isRunning.value && !isStopping.value && inst.value.sourceCategory === 'local'
)
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <Button
      variant="link"
      size="sm"
      class="mt-6 -mb-4"
      data-testid="dashboard-back"
      @click="emit('back')"
      ><ChevronLeft :size="14" />{{ t('buildsDashboard.title') }}</Button
    >

    <header class="flex items-center gap-4 pt-12 pb-8">
      <LocationIcon :kind="inst.sourceCategory === 'cloud' ? 'cloud' : 'local'" :size="40" />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2.5">
          <InlineEdit
            :value="inst.name"
            :editing="isRenaming(inst, 'main')"
            :label="t('buildsDashboard.rename.label')"
            class="text-title font-semibold tracking-[-0.01em]"
            @commit="commitRename(inst, $event)"
            @cancel="cancelRename"
          >
            <h1
              class="truncate text-title font-semibold tracking-[-0.01em]"
              :title="canRename(inst) ? t('buildsDashboard.rename.hint') : undefined"
              @dblclick="startRename(inst, 'main')"
            >
              {{ inst.name }}
            </h1>
          </InlineEdit>
          <Tooltip :content="buildInfo" side="bottom">
            <Badge
              size="md"
              tabindex="0"
              class="shrink-0 cursor-default"
              data-testid="build-type-tag"
              >{{ t(typeMeta.labelKey) }}</Badge
            >
          </Tooltip>
          <InstallBadges
            :installation="inst"
            :is-stopped-action-gated="isStoppedActionGated"
            :is-promoting-to-workspace="isPromotingToWorkspace"
            @view-error="emit('view-error', $event)"
            @view-danger="emit('view-danger', $event)"
            @trigger-action="(action, target) => emit('trigger-action', action, target)"
          />
        </div>
        <p class="mt-1 flex items-center gap-2 text-ui text-muted-foreground">
          <StatusDot :status="dotStatus" />{{ statusLabel }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button v-if="canStop" size="lg" data-testid="dashboard-stop" @click="emit('stop', inst)"
          ><Square :size="12" />{{ t('actions.stop') }}</Button
        >
        <Button
          variant="primary"
          size="lg"
          :disabled="!canLaunch"
          data-testid="dashboard-launch"
          @click="emit('launch', inst)"
        >
          <SquareArrowOutUpRight v-if="isRunning" :size="13" />
          <Play v-else :size="13" />
          {{ isRunning ? t('buildsDashboard.openComfy') : t('buildsDashboard.startComfy') }}
        </Button>
        <Button
          v-if="!isUpdating"
          size="icon-lg"
          :aria-label="t('chooser.moreActions')"
          data-testid="dashboard-page-kebab"
          @click="emit('open-kebab-menu', $event, inst)"
          ><EllipsisVertical :size="15"
        /></Button>
      </div>
    </header>

    <!-- A remote build's files are on its server, not this computer. -->
    <EmptyState
      v-if="inst.sourceCategory === 'remote'"
      :icon="Server"
      :title="t('buildsDashboard.remote.title')"
      :description="t('buildsDashboard.remote.description')"
    />
    <Tabs v-else v-model="tab" :options="tabs">
      <WorkflowsTab
        v-if="tab === 'workflows'"
        :installation="inst"
        @open="emit('launch', $event)"
      />
      <ModelsTab v-else-if="tab === 'models'" :installation="inst" />
      <NodesTab v-else :installation="inst" />
    </Tabs>
  </div>
</template>
