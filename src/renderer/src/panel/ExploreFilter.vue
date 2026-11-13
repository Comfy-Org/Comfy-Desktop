<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import { AudioLines, Box, Check, ChevronDown, ListFilter, Search, Video } from 'lucide-vue-next'
import type { Component } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import MenuSub from '@comfyorg/design-system/menu/MenuSub'
import MenuSubContent from '@comfyorg/design-system/menu/MenuSubContent'
import MenuSubTrigger from '@comfyorg/design-system/menu/MenuSubTrigger'
import ImageGlyph from '../components/ImageGlyph.vue'
import { installTypeMetaFor } from '../lib/installTypeIcon'
import type { ExplorePicks, FacetKey, FilterGroup, FilterOption } from './exploreCards'

const { groups } = defineProps<{ groups: FilterGroup[] }>()
const picks = defineModel<ExplorePicks>({ required: true })

const { t } = useI18n()

const CAPTION = 'text-[11px] font-medium tracking-[0.08em] text-subtle-foreground uppercase'
const TITLES: Record<FacetKey, string> = {
  type: 'explore.filterType',
  use: 'explore.filterUseCase',
  model: 'explore.filterModel',
  runs: 'explore.filterRunsOn'
}
const ICONS: Partial<Record<FacetKey, Record<string, Component>>> = {
  type: { image: ImageGlyph, video: Video, '3d': Box, audio: AudioLines },
  runs: { local: installTypeMetaFor('local').icon, cloud: installTypeMetaFor('cloud').icon }
}
const SEARCHABLE: readonly FacetKey[] = ['model']
const clearShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘⌫' : 'Ctrl+⌫'

const openGroup = ref<FacetKey | null>(null)
const groupSearch = ref('')

const pickedCount = computed(() =>
  Object.values(picks.value).reduce((total, picked) => total + (picked?.length ?? 0), 0)
)

function optionLabel(key: FacetKey, option: FilterOption): string {
  if (key === 'type') return t(`home.category.${option.value}`)
  if (key === 'runs') return t(`explore.runsOn.${option.value}`)
  return option.label
}

function isOn(key: FacetKey, value: string): boolean {
  return picks.value[key]?.includes(value) ?? false
}

function valueOf(group: FilterGroup): string {
  const on = group.options.filter((option) => isOn(group.key, option.value))
  return on.length
    ? on.map((option) => optionLabel(group.key, option)).join(', ')
    : t('explore.all')
}

function listed(group: FilterGroup): FilterOption[] {
  const needle = SEARCHABLE.includes(group.key) ? groupSearch.value.trim().toLowerCase() : ''
  return group.options.filter(
    (option) =>
      (option.count > 0 || isOn(group.key, option.value)) &&
      (!needle || optionLabel(group.key, option).toLowerCase().includes(needle))
  )
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

function clearAll(): void {
  picks.value = {}
}

function toggleGroup(key: FacetKey, open: boolean): void {
  if (open) {
    openGroup.value = key
    groupSearch.value = ''
  } else if (openGroup.value === key) openGroup.value = null
}

function keepTyping(event: KeyboardEvent): void {
  if (!['Escape', 'ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) event.stopPropagation()
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Backspace' || !(event.metaKey || event.ctrlKey) || !pickedCount.value) return
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return
  event.preventDefault()
  clearAll()
})
</script>

<template>
  <Menu
    v-if="groups.length"
    :modal="false"
    align="end"
    :class="groups.length > 1 ? 'z-20 w-64' : 'z-20 w-60'"
    :aria-label="t('explore.filters')"
    @update:open="(open: boolean) => !open && (openGroup = null)"
  >
    <template #trigger>
      <Button
        type="button"
        variant="secondary"
        size="md"
        class="gap-2 pr-2 pl-3 text-ui"
        data-testid="explore-filter"
      >
        <ListFilter :size="14" class="text-subtle-foreground" aria-hidden="true" />
        {{ t('explore.filters') }}
        <span
          v-if="pickedCount"
          class="min-w-4 rounded-full bg-foreground px-1 text-center text-[11px]/4 font-semibold text-background tabular-nums"
          data-testid="explore-filter-count"
        >
          {{ pickedCount }}
        </span>
        <ChevronDown :size="13" class="ml-1 text-subtle-foreground" aria-hidden="true" />
      </Button>
    </template>

    <template v-if="groups.length === 1">
      <div
        :class="['px-3 pt-2 pb-1', CAPTION]"
        :data-testid="`explore-filter-group-${groups[0]!.key}`"
      >
        {{ t(TITLES[groups[0]!.key]) }}
      </div>
      <MenuItem
        v-for="option in listed(groups[0]!)"
        :key="option.value"
        as="button"
        type="button"
        role="menuitemcheckbox"
        :aria-checked="isOn(groups[0]!.key, option.value)"
        class="w-full"
        :data-testid="`explore-filter-${groups[0]!.key}-${option.value}`"
        @select.prevent="flip(groups[0]!, option.value)"
      >
        <component
          :is="ICONS[groups[0]!.key]?.[option.value]"
          v-if="ICONS[groups[0]!.key]?.[option.value]"
          :size="15"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 truncate text-left">
          {{ optionLabel(groups[0]!.key, option) }}
        </span>
        <Check v-if="isOn(groups[0]!.key, option.value)" :size="14" aria-hidden="true" />
        <span v-else class="text-subtle-foreground tabular-nums">{{ option.count }}</span>
      </MenuItem>
    </template>

    <template v-else>
      <MenuSub
        v-for="group in groups"
        :key="group.key"
        :open="openGroup === group.key"
        @update:open="toggleGroup(group.key, $event)"
      >
        <MenuSubTrigger
          class="w-full data-[state=open]:bg-accent"
          :data-testid="`explore-filter-group-${group.key}`"
        >
          <span :class="['flex-1 text-left', CAPTION]">{{ t(TITLES[group.key]) }}</span>
          <span
            class="max-w-[110px] truncate text-ui text-subtle-foreground"
            :data-testid="`explore-filter-value-${group.key}`"
          >
            {{ valueOf(group) }}
          </span>
        </MenuSubTrigger>
        <MenuSubContent :side-offset="8" :align-offset="-4" class="z-30 w-56" max-height="compact">
          <label
            v-if="SEARCHABLE.includes(group.key)"
            class="mb-1 flex h-8 items-center gap-2 rounded-md bg-secondary px-2.5 text-subtle-foreground"
          >
            <Search :size="13" aria-hidden="true" />
            <input
              v-model="groupSearch"
              type="search"
              class="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-ui text-foreground outline-none placeholder:text-subtle-foreground [&::-webkit-search-cancel-button]:hidden"
              :placeholder="t('explore.searchModels')"
              :aria-label="t('explore.searchModels')"
              :data-testid="`explore-filter-search-${group.key}`"
              @keydown="keepTyping"
            />
          </label>
          <MenuItem
            v-for="option in listed(group)"
            :key="option.value"
            as="button"
            type="button"
            role="menuitemcheckbox"
            :aria-checked="isOn(group.key, option.value)"
            class="w-full"
            :data-testid="`explore-filter-${group.key}-${option.value}`"
            @select.prevent="flip(group, option.value)"
          >
            <component
              :is="ICONS[group.key]?.[option.value]"
              v-if="ICONS[group.key]?.[option.value]"
              :size="15"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate text-left">
              {{ optionLabel(group.key, option) }}
            </span>
            <Check v-if="isOn(group.key, option.value)" :size="14" aria-hidden="true" />
            <span v-else class="text-subtle-foreground tabular-nums">{{ option.count }}</span>
          </MenuItem>
          <p v-if="listed(group).length === 0" class="m-0 px-3 py-2 text-ui text-subtle-foreground">
            {{ t('explore.noFilterMatches') }}
          </p>
        </MenuSubContent>
      </MenuSub>
    </template>

    <template v-if="pickedCount">
      <MenuSeparator />
      <MenuItem
        as="button"
        type="button"
        class="w-full"
        data-testid="explore-filter-clear"
        @select="clearAll"
      >
        <span class="flex-1 text-left">{{ t('explore.clearFilters') }}</span>
        <kbd class="font-[inherit] text-[11px] text-subtle-foreground">{{ clearShortcut }}</kbd>
      </MenuItem>
    </template>
  </Menu>
</template>
