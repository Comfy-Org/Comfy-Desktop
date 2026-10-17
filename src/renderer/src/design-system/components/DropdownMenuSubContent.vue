<script setup lang="ts">
import { DropdownMenuPortal, DropdownMenuSubContent } from 'reka-ui'
import { cn } from '../cn'
import { floatingSurface } from '../menu.styles'
import { PORTAL_TO } from '../portal'
</script>

<template>
  <DropdownMenuPortal :to="PORTAL_TO" defer>
    <DropdownMenuSubContent :side-offset="8" :class="cn(floatingSurface, 'min-w-52')">
      <slot />
    </DropdownMenuSubContent>
  </DropdownMenuPortal>
</template>
