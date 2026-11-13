<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DropdownMenuRadioGroup } from 'reka-ui'
import { Check, LayoutGrid } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import type { CardSize, ExploreSort } from './exploreCards'

const size = defineModel<CardSize>('size', { required: true })
const sort = defineModel<ExploreSort>('sort', { required: true })

const { t } = useI18n()

const sizeOptions = computed(() =>
  (['small', 'medium', 'large'] as const).map((value) => ({
    value,
    label: t(`explore.size.${value}`)
  }))
)
const sortOptions = computed(() =>
  (['recommended', 'az'] as const).map((value) => ({ value, label: t(`explore.sort.${value}`) }))
)
</script>

<template>
  <Menu
    :modal="false"
    align="end"
    class="z-20 min-w-[200px]"
    :aria-label="t('explore.viewOptions')"
  >
    <template #trigger>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        :aria-label="t('explore.viewOptions')"
        :title="t('explore.viewOptions')"
        data-testid="explore-view-options"
      >
        <LayoutGrid :size="15" aria-hidden="true" />
      </Button>
    </template>
    <div class="px-3 pt-2 pb-1 text-ui text-subtle-foreground">
      {{ t('explore.sizeLabel') }}
    </div>
    <DropdownMenuRadioGroup :model-value="size">
      <MenuRadioItem
        v-for="option in sizeOptions"
        :key="option.value"
        as="button"
        type="button"
        :value="option.value"
        class="w-full"
        :data-testid="`explore-size-${option.value}`"
        @select.prevent="size = option.value"
      >
        <span class="flex-1 text-left">{{ option.label }}</span>
        <Check v-if="size === option.value" :size="15" aria-hidden="true" />
      </MenuRadioItem>
    </DropdownMenuRadioGroup>
    <MenuSeparator />
    <div class="px-3 pt-2 pb-1 text-ui text-subtle-foreground">
      {{ t('explore.sortLabel') }}
    </div>
    <DropdownMenuRadioGroup :model-value="sort">
      <MenuRadioItem
        v-for="option in sortOptions"
        :key="option.value"
        as="button"
        type="button"
        :value="option.value"
        class="w-full"
        :data-testid="`explore-sort-${option.value}`"
        @select.prevent="sort = option.value"
      >
        <span class="flex-1 text-left">{{ option.label }}</span>
        <Check v-if="sort === option.value" :size="15" aria-hidden="true" />
      </MenuRadioItem>
    </DropdownMenuRadioGroup>
  </Menu>
</template>
