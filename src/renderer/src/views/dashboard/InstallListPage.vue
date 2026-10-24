<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus } from 'lucide-vue-next'
import Button from '../../design-system/components/Button.vue'
import EmptyState from '../../design-system/components/EmptyState.vue'
import PageHeader from '../../design-system/components/PageHeader.vue'
import SegmentedControl from '../../design-system/components/SegmentedControl.vue'
import InstallCard from './InstallCard.vue'
import type { Installation } from '../../types/ipc'

/** All builds: every build of the selected workspace, filterable by where it
 *  runs. Remote builds show under All only. */
const props = defineProps<{
  installations: Installation[]
  showFreeRunsPill: boolean
  showWhyCloud: boolean
  isStoppedActionGated: (inst: Installation) => boolean
  isPromotingToWorkspace: (inst: Installation) => boolean
}>()

const emit = defineEmits<{
  'new-build': []
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

type Where = 'all' | 'local' | 'cloud'
const where = ref<Where>('all')
const countOf = (category: string): number =>
  props.installations.filter((i) => i.sourceCategory === category).length
const options = computed(() => [
  {
    value: 'all' as const,
    label: t('buildsDashboard.filter.all'),
    count: props.installations.length
  },
  {
    value: 'local' as const,
    label: t('buildsDashboard.filter.thisComputer'),
    count: countOf('local')
  },
  { value: 'cloud' as const, label: t('buildsDashboard.filter.cloud'), count: countOf('cloud') }
])
const shown = computed(() =>
  where.value === 'all'
    ? props.installations
    : props.installations.filter((i) => i.sourceCategory === where.value)
)
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader :title="t('buildsDashboard.title')" :description="t('buildsDashboard.description')">
      <template #actions>
        <Button variant="primary" size="lg" @click="emit('new-build')"
          ><Plus :size="15" />{{ t('buildsDashboard.newBuild') }}</Button
        >
      </template>
    </PageHeader>

    <SegmentedControl v-model="where" variant="contained" class="mb-4" :options="options" />

    <!-- Builds exist, but none in this view: nothing to create. -->
    <EmptyState
      v-if="installations.length && !shown.length"
      :title="t('buildsDashboard.empty.filtered')"
    />
    <EmptyState
      v-else-if="!shown.length"
      :title="t('buildsDashboard.empty.title')"
      :description="t('buildsDashboard.empty.description')"
    >
      <Button variant="primary" @click="emit('new-build')"
        ><Plus :size="14" />{{ t('buildsDashboard.newBuild') }}</Button
      >
    </EmptyState>
    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3.5">
      <InstallCard
        v-for="inst in shown"
        :key="inst.id"
        :installation="inst"
        :show-free-runs-pill="showFreeRunsPill && inst.sourceCategory === 'cloud'"
        :show-why-cloud="showWhyCloud && inst.sourceCategory === 'cloud'"
        :is-stopped-action-gated="isStoppedActionGated(inst)"
        :is-promoting-to-workspace="isPromotingToWorkspace(inst)"
        @open="emit('open', $event)"
        @launch="emit('launch', $event)"
        @open-card-menu="(event, target) => emit('open-card-menu', event, target)"
        @open-kebab-menu="(event, target) => emit('open-kebab-menu', event, target)"
        @trigger-action="(action, target) => emit('trigger-action', action, target)"
        @view-error="emit('view-error', $event)"
        @view-danger="emit('view-danger', $event)"
        @why-cloud="emit('why-cloud')"
      />
    </div>
  </div>
</template>
