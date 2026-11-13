<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ListFilter } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import type { CatalogCategory } from '../types/ipc'
import { CATEGORY_ORDER, type CategoryCounts } from './exploreCategories'

const { counts } = defineProps<{ counts: CategoryCounts }>()
const picked = defineModel<CatalogCategory[]>({ required: true })

const { t } = useI18n()

const options = computed(() =>
  CATEGORY_ORDER.filter((category) => (counts[category] ?? 0) > 0).map((category) => ({
    value: category,
    label: t(`home.category.${category}`),
    count: counts[category] ?? 0
  }))
)

function flip(category: CatalogCategory): void {
  picked.value = picked.value.includes(category)
    ? picked.value.filter((value) => value !== category)
    : CATEGORY_ORDER.filter((value) => value === category || picked.value.includes(value))
}
</script>

<template>
  <Menu
    v-if="options.length"
    :modal="false"
    align="end"
    class="z-20 min-w-[180px]"
    :aria-label="t('explore.filterType')"
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
          v-if="picked.length"
          class="min-w-4 rounded-full bg-foreground px-1 text-center text-[11px]/4 font-semibold text-background tabular-nums"
          data-testid="explore-filter-count"
        >
          {{ picked.length }}
        </span>
      </Button>
    </template>
    <div class="px-3 pt-2 pb-1 text-ui text-subtle-foreground">
      {{ t('explore.filterType') }}
    </div>
    <MenuItem
      v-for="option in options"
      :key="option.value"
      as="button"
      type="button"
      role="menuitemcheckbox"
      :aria-checked="picked.includes(option.value)"
      class="w-full"
      :data-testid="`explore-filter-${option.value}`"
      @select.prevent="flip(option.value)"
    >
      <span class="flex-1 text-left">{{ option.label }}</span>
      <Check v-if="picked.includes(option.value)" :size="15" aria-hidden="true" />
      <span v-else class="text-subtle-foreground tabular-nums">{{ option.count }}</span>
    </MenuItem>
  </Menu>
</template>
