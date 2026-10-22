<script setup lang="ts">
import { cn } from '../../ui/cn'
import { BRAND_ICONS } from './brandIcons'
import type { SpaceBrand } from '../../spaces'

/** A space's logo: the brand mark on its tile (or the letter), optionally
 *  with the name. */
const {
  brand,
  size = 'sm',
  named = false,
  class: className
} = defineProps<{
  brand: SpaceBrand
  size?: 'xs' | 'sm' | 'md' | 'lg'
  named?: boolean
  class?: string
}>()
const SIZE = {
  xs: 'size-4 rounded-min text-[9px] p-[2px]',
  sm: 'size-6 rounded-control text-ui p-1',
  md: 'size-8 rounded-control text-ui p-1.5',
  lg: 'size-12 rounded-card text-title p-2'
}
</script>

<template>
  <span :class="cn('inline-flex min-w-0 items-center gap-2.5', className)">
    <span
      :class="
        cn(
          'inline-flex shrink-0 items-center justify-center font-bold [&_svg]:size-full',
          SIZE[size]
        )
      "
      :style="{ background: brand.logo.bg ?? brand.color, color: brand.logo.fg ?? '#fff' }"
    >
      <!-- eslint-disable-next-line vue/no-v-html -- bundled static SVG -->
      <span
        v-if="brand.logo.icon && BRAND_ICONS[brand.logo.icon]"
        class="contents"
        v-html="BRAND_ICONS[brand.logo.icon]"
      />
      <template v-else>{{ brand.logo.mark }}</template>
    </span>
    <span
      v-if="named"
      :class="
        cn('truncate font-semibold tracking-[-0.01em]', size === 'lg' ? 'text-title' : 'text-ui')
      "
      >{{ brand.logo.name }}</span
    >
  </span>
</template>
