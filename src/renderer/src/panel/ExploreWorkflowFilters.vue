<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import { ChevronDown, ListFilter } from '@lucide/vue'
import { DropdownMenuRadioGroup } from 'reka-ui'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import MenuSub from '@comfyorg/design-system/menu/MenuSub'
import MenuSubContent from '@comfyorg/design-system/menu/MenuSubContent'
import MenuSubTrigger from '@comfyorg/design-system/menu/MenuSubTrigger'
import { shortcutBelongsToOverlay } from '../lib/pageShortcuts'
import {
  activeFilterCount,
  NO_FILTERS,
  RUNS_ON,
  type FacetOption,
  type WorkflowFacets,
  type WorkflowFilters
} from './exploreWorkflows'
import { useWorkflowLabels } from './useWorkflowLabels'

type GroupKey = keyof WorkflowFilters

const { facets } = defineProps<{ facets: WorkflowFacets }>()
const filters = defineModel<WorkflowFilters>({ required: true })

const { t } = useI18n()
const labels = useWorkflowLabels()

const ALL = '__all__'
const CAPTION = 'text-[11px] font-medium tracking-[0.08em] text-subtle-foreground uppercase'
const clearShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘⌫' : 'Ctrl+⌫'

const count = computed(() => activeFilterCount(filters.value))

const groups = computed<{ key: GroupKey; title: string; options: FacetOption[] }[]>(() => [
  { key: 'useCase', title: t('workflows.filters.useCase'), options: facets.useCases },
  { key: 'model', title: t('workflows.filters.model'), options: facets.models },
  {
    key: 'runsOn',
    title: t('workflows.filters.runsOn'),
    options: RUNS_ON.map((value) => ({ value, count: 0 }))
  }
])

function optionLabel(key: GroupKey, value: string): string {
  if (key === 'useCase') return labels.useCase(value)
  if (key === 'runsOn') return t(`workflows.filters.runsOnOption.${value}`)
  return value
}

function valueLabel(key: GroupKey): string {
  const value = filters.value[key]
  return value === null ? t('workflows.filters.all') : optionLabel(key, value)
}

function pick(key: GroupKey, value: string): void {
  filters.value = { ...filters.value, [key]: value === ALL ? null : value }
}

function clear(): void {
  filters.value = { ...NO_FILTERS }
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Backspace' || !(event.metaKey || event.ctrlKey) || count.value === 0) return
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return
  if (shortcutBelongsToOverlay(event)) return
  event.preventDefault()
  clear()
})
</script>

<template>
  <Menu
    :modal="false"
    align="end"
    :side-offset="6"
    class="z-20 w-64"
    :aria-label="t('workflows.filters.label')"
  >
    <template #trigger>
      <Button
        type="button"
        variant="secondary"
        size="unset"
        class="h-[34px] gap-2 rounded-[10px] pr-3 pl-[15px] text-[13px] font-normal data-[state=open]:bg-accent"
        data-testid="explore-filters"
      >
        <ListFilter :size="14" class="text-muted-foreground" aria-hidden="true" />
        {{ t('workflows.filters.label') }}
        <span
          v-if="count > 0"
          class="grid size-[18px] place-items-center rounded-full bg-accent text-[11px] font-medium text-muted-foreground tabular-nums"
          data-testid="explore-filters-count"
        >
          {{ count }}
        </span>
        <ChevronDown :size="13" class="ml-1 text-muted-foreground" aria-hidden="true" />
      </Button>
    </template>

    <MenuSub v-for="group in groups" :key="group.key">
      <MenuSubTrigger class="h-[34px] w-full gap-3" :data-testid="`explore-filter-${group.key}`">
        <span :class="['flex-1 text-left', CAPTION]">{{ group.title }}</span>
        <span
          class="max-w-28 truncate text-[13px] text-muted-foreground"
          :data-testid="`explore-filter-value-${group.key}`"
        >
          {{ valueLabel(group.key) }}
        </span>
      </MenuSubTrigger>
      <MenuSubContent :side-offset="6" class="z-30 max-h-80 w-56 overflow-y-auto">
        <DropdownMenuRadioGroup
          :model-value="filters[group.key] ?? ALL"
          class="flex flex-col gap-0.5"
          @update:model-value="pick(group.key, String($event))"
        >
          <MenuRadioItem
            :value="ALL"
            :data-testid="`explore-filter-${group.key}-all`"
            @select.prevent
          >
            {{ t('workflows.filters.all') }}
          </MenuRadioItem>
          <MenuRadioItem
            v-for="option in group.options"
            :key="option.value"
            :value="option.value"
            :data-testid="`explore-filter-${group.key}-${option.value}`"
            @select.prevent
          >
            <span class="min-w-0 flex-1 truncate text-left">
              {{ optionLabel(group.key, option.value) }}
            </span>
            <span v-if="option.count > 0" class="text-subtle-foreground tabular-nums">
              {{ option.count }}
            </span>
          </MenuRadioItem>
        </DropdownMenuRadioGroup>
      </MenuSubContent>
    </MenuSub>

    <MenuSeparator class="-mx-1" />
    <MenuItem
      class="h-[34px] w-full"
      :disabled="count === 0"
      data-testid="explore-filters-clear"
      @select="clear"
    >
      <span class="flex-1 text-left">{{ t('workflows.filters.clear') }}</span>
      <kbd class="font-[inherit] text-[11px] text-subtle-foreground">{{ clearShortcut }}</kbd>
    </MenuItem>
  </Menu>
</template>
