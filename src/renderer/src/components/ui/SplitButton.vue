<script setup lang="ts">
import { ref, useSlots, useTemplateRef, watch, type ComponentPublicInstance } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import ButtonGroup from '@comfyorg/design-system/button-group/ButtonGroup'
import Menu from '@comfyorg/design-system/menu/Menu'
import Tooltip from './Tooltip.vue'

const {
  label,
  menuLabel,
  tooltip = undefined,
  mainTestid = undefined,
  menuTestid = undefined
} = defineProps<{
  label: string
  menuLabel: string
  tooltip?: string
  mainTestid?: string
  menuTestid?: string
}>()
const emit = defineEmits<{ run: [] }>()
const open = defineModel<boolean>('open', { default: false })
const slots = useSlots()

const MENU_CHROME_PX = 10
const MENU_OVERHANG_PX = 8
const group = useTemplateRef<ComponentPublicInstance | HTMLElement>('group')
const menuMinWidth = ref(0)
watch(open, (isOpen) => {
  if (!isOpen) return
  const el = group.value instanceof HTMLElement ? group.value : group.value?.$el
  menuMinWidth.value =
    el instanceof HTMLElement ? el.offsetWidth + MENU_OVERHANG_PX - MENU_CHROME_PX : 0
})
</script>

<template>
  <component :is="slots.menu ? ButtonGroup : 'div'" ref="group" class="inline-flex rounded-lg">
    <Tooltip :text="tooltip" :disabled="open" side="bottom" align="end">
      <Button
        type="button"
        variant="inverted"
        size="md"
        class="gap-1 px-3 text-[13px]/5 font-medium"
        :class="slots.menu && 'rounded-none'"
        :aria-label="label"
        :data-testid="mainTestid"
        @click="emit('run')"
      >
        <slot />
      </Button>
    </Tooltip>
    <Menu
      v-if="slots.menu"
      v-model:open="open"
      :modal="false"
      align="end"
      :side-offset="6"
      class="z-[9999] min-w-0 max-w-80"
      :aria-label="menuLabel"
    >
      <template #trigger>
        <Button
          type="button"
          variant="inverted"
          size="md"
          class="w-[30px] rounded-none border-l border-solid border-background/18 p-0 data-[state=open]:bg-foreground/80"
          :aria-label="menuLabel"
          :data-testid="menuTestid"
        >
          <ChevronDown :size="14" aria-hidden="true" />
        </Button>
      </template>
      <div :style="{ minWidth: `${menuMinWidth}px` }" data-testid="split-button-menu-body">
        <slot name="menu" />
      </div>
    </Menu>
  </component>
</template>
