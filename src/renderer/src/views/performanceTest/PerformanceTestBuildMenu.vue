<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Menu from '@comfyorg/design-system/menu/Menu'
import { DropdownMenuRadioGroup } from 'reka-ui'
import BaseMenuRadioItem from '../../components/ui/BaseMenuRadioItem.vue'
import FilterButton from '../../components/ui/FilterButton.vue'

export interface BuildOption {
  value: string
  label: string
  description: string
}

const props = defineProps<{
  options: BuildOption[]
}>()

const selectedId = defineModel<string | null>({ required: true })

const { t } = useI18n()
const selected = computed(() => props.options.find((option) => option.value === selectedId.value))
</script>

<template>
  <Menu
    :modal="false"
    align="start"
    class="z-20 max-w-[min(28rem,calc(100vw-2rem))] min-w-[var(--reka-dropdown-menu-trigger-width)]"
    :aria-label="t('performanceTest.selectInstancePlaceholder')"
  >
    <template #trigger>
      <FilterButton
        class="performance-test__build-trigger max-w-64 @max-[36rem]/setup:w-full @max-[36rem]/setup:max-w-none"
        :label="t('performanceTest.selectInstance')"
        :value="selected?.label"
        :placeholder="t('performanceTest.selectInstancePlaceholder')"
        :aria-label="
          selected
            ? t('performanceTest.buildTriggerLabel', { build: selected.label })
            : t('performanceTest.selectInstancePlaceholder')
        "
        :disabled="options.length === 0"
      />
    </template>
    <DropdownMenuRadioGroup
      :model-value="selectedId ?? ''"
      @update:model-value="selectedId = typeof $event === 'string' && $event ? $event : null"
    >
      <BaseMenuRadioItem
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        class="performance-test__build-option"
      >
        <span class="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span class="performance-test__build-option-label truncate">{{ option.label }}</span>
          <span
            v-if="option.description"
            class="performance-test__build-option-description truncate text-xs text-muted-foreground"
            >{{ option.description }}</span
          >
        </span>
      </BaseMenuRadioItem>
    </DropdownMenuRadioGroup>
  </Menu>
</template>
