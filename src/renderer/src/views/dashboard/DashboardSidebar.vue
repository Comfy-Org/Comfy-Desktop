<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LayoutGrid, Plus } from 'lucide-vue-next'
import Button from '../../design-system/components/Button.vue'
import LocationIcon from '../../design-system/components/LocationIcon.vue'
import StatusDot from '../../design-system/components/StatusDot.vue'
import Tooltip from '../../design-system/components/Tooltip.vue'
import { cn } from '../../design-system/cn'
import { useSessionStore } from '../../stores/sessionStore'
import { ALL_BUILDS, installPage, isSamePage } from './dashboardPage'
import type { DashboardPage } from './dashboardPage'
import type { Installation } from '../../types/ipc'

/** The dashboard's sidebar: every build in the selected workspace, with the
 *  workspace and account at its foot (`#foot`). */
const { installations } = defineProps<{ installations: Installation[] }>()
const page = defineModel<DashboardPage>('page', { required: true })
const emit = defineEmits<{ 'new-build': [] }>()

const { t } = useI18n()
const sessionStore = useSessionStore()

function rowClass(target: DashboardPage): string {
  return cn(
    'h-8 w-full justify-start gap-2.5 px-3 text-ui font-normal',
    isSamePage(page.value, target)
      ? 'bg-secondary-background-hover text-base-foreground'
      : 'bg-transparent text-muted-foreground'
  )
}
</script>

<template>
  <aside
    class="ds-sidebar relative m-2 mr-0 flex w-59 shrink-0 flex-col overflow-y-auto p-2 [scrollbar-width:none]"
    :aria-label="t('buildsDashboard.sidebar.label')"
  >
    <div class="mt-1.5 flex shrink-0 flex-col">
      <div class="flex h-6.5 items-center justify-between pr-1 pl-3">
        <span class="text-ui font-medium tracking-wider text-subtle-foreground uppercase">{{
          t('buildsDashboard.sidebar.builds')
        }}</span>
        <Tooltip :content="t('buildsDashboard.newBuild')">
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="t('buildsDashboard.newBuild')"
            data-testid="dashboard-new-build"
            @click="emit('new-build')"
          >
            <Plus :size="13" />
          </Button>
        </Tooltip>
      </div>

      <Button
        variant="ghost"
        :aria-current="isSamePage(page, ALL_BUILDS) ? 'page' : undefined"
        :class="rowClass(ALL_BUILDS)"
        data-testid="dashboard-all-builds"
        @click="page = ALL_BUILDS"
      >
        <LayoutGrid :size="15" />
        <span class="sidebar-label text-left">{{ t('buildsDashboard.allBuilds') }}</span>
        <span class="text-ui text-subtle-foreground tabular-nums">{{ installations.length }}</span>
      </Button>

      <Button
        v-for="inst in installations"
        :key="inst.id"
        variant="ghost"
        :aria-current="isSamePage(page, installPage(inst.id)) ? 'page' : undefined"
        :class="rowClass(installPage(inst.id))"
        :data-testid="`dashboard-sidebar-build-${inst.id}`"
        @click="page = installPage(inst.id)"
      >
        <LocationIcon :kind="inst.sourceCategory === 'cloud' ? 'cloud' : 'local'" :size="16" />
        <span class="sidebar-label text-left">{{ inst.name }}</span>
        <template v-if="sessionStore.isRunning(inst.id)">
          <StatusDot status="running" />
          <span class="sr-only">{{ t('chooser.statusRunning') }}</span>
        </template>
      </Button>
    </div>

    <div class="mt-auto flex flex-col gap-2 pt-3"><slot name="foot" /></div>
  </aside>
</template>
