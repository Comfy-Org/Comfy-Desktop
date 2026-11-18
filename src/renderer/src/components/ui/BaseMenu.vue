<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'

export interface BaseMenuItem {
  id: string
  label: string
  disabled?: boolean
  style?: 'default' | 'danger'
  separator?: boolean
  detail?: string
}

interface Props {
  items: BaseMenuItem[]
  triggerAriaLabel?: string
  minWidth?: number
  align?: 'start' | 'end'
  offset?: number
  heading?: string
  listClass?: string
}
withDefaults(defineProps<Props>(), {
  triggerAriaLabel: undefined,
  minWidth: undefined,
  heading: undefined,
  listClass: undefined,
  align: 'start',
  offset: 4
})
const emit = defineEmits<{ select: [id: string] }>()
const open = ref(false)
let suppressFocusReturn = false
function onWindowBlur(): void {
  if (!open.value) return
  suppressFocusReturn = true
  open.value = false
}
function onCloseAutoFocus(event: Event): void {
  if (suppressFocusReturn) event.preventDefault()
  suppressFocusReturn = false
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  open.value = false
}
onMounted(() => window.addEventListener('blur', onWindowBlur))
onBeforeUnmount(() => window.removeEventListener('blur', onWindowBlur))
</script>

<template>
  <Menu
    v-model:open="open"
    :modal="false"
    :align="align"
    :side-offset="offset"
    :collision-padding="4"
    class="ui-menu-list z-[9999]"
    :class="listClass"
    :style="minWidth ? { minWidth: `${minWidth}px` } : undefined"
    :aria-label="triggerAriaLabel"
    @keydown.capture="onKeydown"
    @close-auto-focus="onCloseAutoFocus"
  >
    <template #trigger>
      <Button
        class="ui-menu-trigger"
        variant="secondary"
        size="md"
        :disabled="items.length === 0"
        :aria-label="triggerAriaLabel"
        ><slot
      /></Button>
    </template>
    <div
      v-if="heading"
      class="ui-menu-heading px-3 py-1.5 text-xs text-muted-foreground"
      role="presentation"
    >
      {{ heading }}
    </div>
    <template v-for="(item, index) in items" :key="item.id">
      <MenuSeparator v-if="item.separator && index > 0" class="ui-menu-separator" />
      <MenuItem
        class="ui-menu-item"
        :class="item.style === 'danger' ? 'text-destructive focus:text-destructive' : undefined"
        :disabled="item.disabled"
        :text-value="item.label"
        :data-danger="item.style === 'danger' ? '' : undefined"
        @select="emit('select', item.id)"
      >
        <span class="ui-menu-item-label">{{ item.label }}</span>
        <span
          v-if="item.detail"
          class="ui-menu-item-detail min-w-0 whitespace-normal text-muted-foreground [overflow-wrap:anywhere]"
          >{{ item.detail }}</span
        >
      </MenuItem>
    </template>
  </Menu>
</template>
