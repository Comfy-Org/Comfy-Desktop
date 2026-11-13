<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LayoutGrid, Minus, Plus } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSub from '@comfyorg/design-system/menu/MenuSub'
import MenuSubContent from '@comfyorg/design-system/menu/MenuSubContent'
import MenuSubTrigger from '@comfyorg/design-system/menu/MenuSubTrigger'
import { CARD_SIZES, type CardSize, type ExploreSort } from './exploreCards'

const size = defineModel<CardSize>('size', { required: true })
const sort = defineModel<ExploreSort>('sort', { required: true })

const { t } = useI18n()

const CAPTION = 'text-[11px] font-medium tracking-[0.08em] text-subtle-foreground uppercase'
const STEP_CLASS =
  'inline-flex size-6 items-center justify-center rounded-full bg-white/7 text-foreground hover:bg-white/12 disabled:opacity-35 disabled:hover:bg-white/7'

const sortOpen = ref(false)
const step = computed(() => CARD_SIZES.indexOf(size.value))
const sortOptions = computed(() =>
  (['recommended', 'az'] as const).map((value) => ({ value, label: t(`explore.sort.${value}`) }))
)
const sortLabel = computed(() => sortOptions.value.find((o) => o.value === sort.value)?.label)

function stepTo(index: number): void {
  size.value = CARD_SIZES[Math.min(CARD_SIZES.length - 1, Math.max(0, index))]!
}
</script>

<template>
  <Menu
    :modal="false"
    align="end"
    class="z-20 w-64"
    :aria-label="t('explore.viewOptions')"
    @update:open="(open: boolean) => !open && (sortOpen = false)"
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
    <div class="flex items-center gap-1.5 px-2.5 pt-2 pb-1.5">
      <span :class="['flex-1', CAPTION]">{{ t('explore.sizeLabel') }}</span>
      <button
        type="button"
        :class="STEP_CLASS"
        :aria-label="t('explore.smaller')"
        :disabled="step <= 0"
        data-testid="explore-size-smaller"
        @click="stepTo(step - 1)"
      >
        <Minus :size="13" aria-hidden="true" />
      </button>
      <div
        class="flex h-[18px] w-24 gap-0.5 overflow-hidden rounded-md"
        role="group"
        :aria-label="t('explore.sizeLabel')"
      >
        <button
          v-for="(value, index) in CARD_SIZES"
          :key="value"
          type="button"
          class="flex-1"
          :class="index <= step ? 'bg-white/38' : 'bg-white/7'"
          :aria-label="t(`explore.size.${value}`)"
          :aria-pressed="value === size"
          :data-testid="`explore-size-${value}`"
          @click="size = value"
        />
      </div>
      <button
        type="button"
        :class="STEP_CLASS"
        :aria-label="t('explore.bigger')"
        :disabled="step >= CARD_SIZES.length - 1"
        data-testid="explore-size-bigger"
        @click="stepTo(step + 1)"
      >
        <Plus :size="13" aria-hidden="true" />
      </button>
    </div>
    <MenuSub :open="sortOpen" @update:open="sortOpen = $event">
      <MenuSubTrigger class="w-full data-[state=open]:bg-accent" data-testid="explore-sort">
        <span :class="['flex-1 text-left', CAPTION]">{{ t('explore.sortLabel') }}</span>
        <span class="text-ui text-subtle-foreground" data-testid="explore-sort-value">
          {{ sortLabel }}
        </span>
      </MenuSubTrigger>
      <MenuSubContent :side-offset="8" :align-offset="-4" class="z-30 w-48">
        <MenuItem
          v-for="option in sortOptions"
          :key="option.value"
          as="button"
          type="button"
          class="w-full"
          :class="sort === option.value && 'bg-muted'"
          :aria-current="sort === option.value ? 'true' : undefined"
          :data-testid="`explore-sort-${option.value}`"
          @select="sort = option.value"
        >
          <span class="flex-1 text-left">{{ option.label }}</span>
        </MenuItem>
      </MenuSubContent>
    </MenuSub>
  </Menu>
</template>
