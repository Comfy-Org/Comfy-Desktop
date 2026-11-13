<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ListFilter } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import type { ExplorePicks, FacetKey, FilterGroup, FilterOption } from './exploreCards'

const { groups } = defineProps<{ groups: FilterGroup[] }>()
const picks = defineModel<ExplorePicks>({ required: true })

const { t } = useI18n()

const pickedCount = computed(() =>
  Object.values(picks.value).reduce((total, picked) => total + (picked?.length ?? 0), 0)
)

const TITLES: Record<FacetKey, string> = {
  type: 'explore.filterType',
  use: 'explore.filterUseCase',
  model: 'explore.filterModel',
  runs: 'explore.filterRunsOn'
}

function optionLabel(key: FacetKey, option: FilterOption): string {
  if (key === 'type') return t(`home.category.${option.value}`)
  if (key === 'runs') return t(`explore.runsOn.${option.value}`)
  return option.label
}

function isOn(key: FacetKey, value: string): boolean {
  return picks.value[key]?.includes(value) ?? false
}

function flip(group: FilterGroup, value: string): void {
  const picked = picks.value[group.key] ?? []
  const next = picked.includes(value)
    ? picked.filter((item) => item !== value)
    : group.options
        .map((option) => option.value)
        .filter((item) => item === value || picked.includes(item))
  picks.value = { ...picks.value, [group.key]: next }
}
</script>

<template>
  <Menu
    v-if="groups.length"
    :modal="false"
    align="end"
    class="z-20 max-h-[min(70vh,520px)] min-w-[220px] overflow-y-auto"
    :aria-label="t('explore.filters')"
  >
    <template #trigger>
      <Button
        type="button"
        variant="secondary"
        size="md"
        class="gap-1.5 px-3 text-ui"
        data-testid="explore-filter"
      >
        <ListFilter :size="15" aria-hidden="true" />
        {{ t('explore.filters') }}
        <span
          v-if="pickedCount"
          class="min-w-4 rounded-full bg-foreground px-1 text-center text-[11px]/4 font-semibold text-background tabular-nums"
          data-testid="explore-filter-count"
        >
          {{ pickedCount }}
        </span>
      </Button>
    </template>
    <template v-for="(group, index) in groups" :key="group.key">
      <MenuSeparator v-if="index > 0" />
      <div
        class="px-3 pt-2 pb-1 text-ui text-subtle-foreground"
        :data-testid="`explore-filter-group-${group.key}`"
      >
        {{ t(TITLES[group.key]) }}
      </div>
      <MenuItem
        v-for="option in group.options"
        :key="option.value"
        as="button"
        type="button"
        role="menuitemcheckbox"
        :aria-checked="isOn(group.key, option.value)"
        :disabled="option.count === 0 && !isOn(group.key, option.value)"
        class="w-full"
        :data-testid="`explore-filter-${group.key}-${option.value}`"
        @select.prevent="flip(group, option.value)"
      >
        <span class="min-w-0 flex-1 truncate text-left">{{ optionLabel(group.key, option) }}</span>
        <Check v-if="isOn(group.key, option.value)" :size="15" aria-hidden="true" />
        <span v-else class="text-subtle-foreground tabular-nums">{{ option.count }}</span>
      </MenuItem>
    </template>
  </Menu>
</template>
