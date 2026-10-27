<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { cn } from '../../ui/cn'
import AppThemeFrame from './AppThemeFrame.vue'
import { flow, type AppLayout } from '../../appFlow'
import type { AppTheme } from '../../appTheme'

/** The real app page, scaled down to fit (a live picture, not a
 *  wireframe): theme cards, the look card, previews. Not interactive. */
const {
  theme,
  layout,
  class: className
} = defineProps<{ theme: AppTheme; layout: AppLayout; class?: string }>()
const WIDTH = 1100
const box = ref<HTMLElement>()
const scale = ref(0.25)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => (scale.value = (e?.contentRect.width ?? 0) / WIDTH))
  if (box.value) ro.observe(box.value)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div
    ref="box"
    :class="cn('pointer-events-none relative overflow-hidden select-none', className)"
    aria-hidden="true"
  >
    <div
      class="absolute top-0 left-0 origin-top-left"
      :style="{ width: `${WIDTH}px`, transform: `scale(${scale})` }"
    >
      <AppThemeFrame
        v-if="flow.draft"
        :name="flow.draft.name"
        :blurb="flow.draft.blurb"
        author="Pablo · Silverside"
        :thumb-id="flow.draft.thumbId"
        :fields="flow.draft.fields"
        :cost="flow.draft.cost"
        payer="Paid by you while it is a draft"
        :layout
        :theme
      />
    </div>
  </div>
</template>
