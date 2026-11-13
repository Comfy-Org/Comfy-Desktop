<script setup lang="ts">
import { DropdownMenuItemIndicator } from 'reka-ui'
import { Check } from 'lucide-vue-next'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'

defineProps<{
  value: string
  disabled?: boolean
}>()
</script>

<template>
  <MenuRadioItem
    :value="value"
    :disabled="disabled"
    class="data-[state=checked]:bg-muted data-[state=checked]:data-highlighted:bg-accent"
  >
    <slot />
    <DropdownMenuItemIndicator class="ml-auto shrink-0" data-testid="menu-radio-item-check">
      <Check :size="15" aria-hidden="true" />
    </DropdownMenuItemIndicator>
  </MenuRadioItem>
</template>
