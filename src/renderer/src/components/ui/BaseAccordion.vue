<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core'
import TransitionCollapse from '@comfyorg/design-system/transition/TransitionCollapse'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{ open: boolean; duration?: number }>(), { duration: 220 })
const reducedMotion = usePreferredReducedMotion()
</script>

<template>
  <TransitionCollapse :duration="duration" :disable="reducedMotion === 'reduce'">
    <div
      v-show="open"
      v-bind="$attrs"
      class="ui-accordion"
      :class="{ 'is-open': open }"
      :data-state="open ? 'open' : 'closed'"
      :aria-hidden="!open"
      :inert="!open || undefined"
    >
      <slot />
    </div>
  </TransitionCollapse>
</template>
