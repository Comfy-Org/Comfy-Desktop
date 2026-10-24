<script setup lang="ts">
import { DropdownMenuPortal, DropdownMenuSubContent } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '../cn'
import { floatingSurface } from '../menu.styles'
import { PORTAL_TO } from '../portal'

// The root is a portal: attributes and listeners belong on the content.
defineOptions({ inheritAttrs: false })

const { class: className } = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <DropdownMenuPortal :to="PORTAL_TO" defer>
    <DropdownMenuSubContent
      v-bind="$attrs"
      :side-offset="8"
      :class="cn(floatingSurface, 'min-w-52', className)"
    >
      <slot />
    </DropdownMenuSubContent>
  </DropdownMenuPortal>
</template>
