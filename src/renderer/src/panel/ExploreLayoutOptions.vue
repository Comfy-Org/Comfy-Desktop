<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LayoutGrid, Minus, Plus } from '@lucide/vue'
import { DropdownMenuRadioGroup } from 'reka-ui'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import MenuSub from '@comfyorg/design-system/menu/MenuSub'
import MenuSubContent from '@comfyorg/design-system/menu/MenuSubContent'
import MenuSubTrigger from '@comfyorg/design-system/menu/MenuSubTrigger'
import { CARD_SIZES, WORKFLOW_SORTS, type CardSize, type WorkflowSort } from './exploreWorkflows'

const size = defineModel<CardSize>('size', { required: true })
const sort = defineModel<WorkflowSort>('sort', { required: true })

const { t } = useI18n()

const CAPTION = 'text-[11px] font-medium tracking-[0.08em] text-subtle-foreground uppercase'
const STEP_CLASS =
  'grid size-6 place-items-center rounded-full border-0 bg-white/7 p-0 text-foreground outline-none hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35 disabled:hover:bg-white/7'

const step = computed(() => CARD_SIZES.indexOf(size.value))

function stepTo(index: number): void {
  size.value = CARD_SIZES[Math.min(CARD_SIZES.length - 1, Math.max(0, index))]!
}
</script>

<template>
  <Menu
    :modal="false"
    align="end"
    :side-offset="6"
    class="z-20 w-64"
    :aria-label="t('workflows.layout.label')"
  >
    <template #trigger>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        class="size-8 rounded-[9px] data-[state=open]:bg-accent"
        :aria-label="t('workflows.layout.label')"
        data-testid="explore-layout"
      >
        <LayoutGrid :size="15" aria-hidden="true" />
      </Button>
    </template>

    <div class="flex h-[34px] items-center gap-1.5 pr-2 pl-3" data-testid="explore-size">
      <span :class="['flex-1', CAPTION]">{{ t('workflows.layout.size') }}</span>
      <button
        type="button"
        :class="STEP_CLASS"
        :aria-label="t('workflows.layout.smaller')"
        :disabled="step <= 0"
        data-testid="explore-size-smaller"
        @click="stepTo(step - 1)"
      >
        <Minus :size="13" aria-hidden="true" />
      </button>
      <div class="grid h-[18px] w-24 grid-cols-3 overflow-hidden rounded-md">
        <button
          v-for="(value, index) in CARD_SIZES"
          :key="value"
          type="button"
          class="h-full border-0 p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="index <= step ? 'bg-white/38' : 'bg-white/7'"
          :aria-label="t(`workflows.layout.sizes.${value}`)"
          :aria-pressed="value === size"
          :data-testid="`explore-size-${value}`"
          @click="size = value"
        />
      </div>
      <button
        type="button"
        :class="STEP_CLASS"
        :aria-label="t('workflows.layout.larger')"
        :disabled="step >= CARD_SIZES.length - 1"
        data-testid="explore-size-larger"
        @click="stepTo(step + 1)"
      >
        <Plus :size="13" aria-hidden="true" />
      </button>
    </div>

    <MenuSub>
      <MenuSubTrigger class="h-[34px] w-full gap-3" data-testid="explore-sort">
        <span :class="['flex-1 text-left', CAPTION]">{{ t('workflows.layout.sortBy') }}</span>
        <span class="text-[13px] text-muted-foreground" data-testid="explore-sort-value">
          {{ t(`workflows.layout.sorts.${sort}`) }}
        </span>
      </MenuSubTrigger>
      <MenuSubContent :side-offset="6" class="z-30 w-44">
        <DropdownMenuRadioGroup
          :model-value="sort"
          class="flex flex-col gap-0.5"
          @update:model-value="sort = $event as WorkflowSort"
        >
          <MenuRadioItem
            v-for="value in WORKFLOW_SORTS"
            :key="value"
            :value="value"
            :data-testid="`explore-sort-${value}`"
          >
            {{ t(`workflows.layout.sorts.${value}`) }}
          </MenuRadioItem>
        </DropdownMenuRadioGroup>
      </MenuSubContent>
    </MenuSub>
  </Menu>
</template>
