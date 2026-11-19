<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuAction from '@comfyorg/design-system/menu/MenuAction'
import type { MenuItemAction } from '@comfyorg/design-system/lib/menu/types'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import { TID } from '../../../shared/testIds'
import InfoTooltip from './InfoTooltip.vue'
import type { ContextMenuItem } from '../types/context-menu'

const props = defineProps<{
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}>()
const emit = defineEmits<{ close: []; select: [id: string] }>()
const visible = computed({
  get: () => props.open && props.items.length > 0,
  set: (open: boolean) => {
    if (!open) emit('close')
  }
})
const reference = computed(() => ({
  getBoundingClientRect: () => new DOMRect(props.x, props.y, 1, 1)
}))
const entries = computed(() =>
  props.items.map((item) => ({
    ...item,
    action: {
      label: item.label,
      command: () => emit('select', item.id),
      disabled: item.disabled,
      focusableWhenDisabled: !!item.hint,
      class: `context-menu-item ${item.disabled ? 'disabled' : ''} ${item.style === 'danger' ? 'is-danger' : ''}`,
      variant: item.style === 'danger' ? 'destructive' : undefined
    } satisfies MenuItemAction
  }))
)
let focusToRestore: HTMLElement | null = null
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  emit('close')
}
function onInteractOutside(event: Event): void {
  const target = (event as CustomEvent<{ originalEvent: Event }>).detail?.originalEvent.target
  if (target instanceof Element && target.closest('.tooltip-bubble--interactive')) {
    event.preventDefault()
    return
  }
  focusToRestore = null
}
function onWindowBlur(): void {
  if (!props.open) return
  focusToRestore = null
  emit('close')
}
watch(visible, (isVisible) => {
  if (isVisible) {
    focusToRestore = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
})
function onCloseAutoFocus(event: Event): void {
  event.preventDefault()
  const element = focusToRestore
  focusToRestore = null
  setTimeout(() => {
    if (document.activeElement === document.body) element?.focus({ preventScroll: true })
  })
}
onMounted(() => window.addEventListener('blur', onWindowBlur))
onBeforeUnmount(() => window.removeEventListener('blur', onWindowBlur))
</script>

<template>
  <Menu
    v-model:open="visible"
    :modal="false"
    :reference="reference"
    :collision-padding="4"
    :side-offset="0"
    class="context-menu z-[10000] min-w-[200px]"
    @keydown.capture="onKeydown"
    @interact-outside="onInteractOutside"
    @close-auto-focus="onCloseAutoFocus"
  >
    <template #trigger><span hidden aria-hidden="true" /></template>
    <template v-for="(item, index) in entries" :key="item.id">
      <MenuSeparator v-if="item.separator && index > 0" class="context-menu-separator" />
      <MenuAction :item="item.action">
        <component
          :is="item.icon"
          v-if="item.icon"
          :size="15"
          class="shrink-0"
          aria-hidden="true"
        />
        <span
          class="context-menu-item-action flex-1"
          :title="item.disabled ? item.title : undefined"
          :data-testid="TID.contextMenuItem(item.id)"
          >{{ item.label }}</span
        >
        <InfoTooltip
          v-if="item.hint"
          class="context-menu-item-info ml-auto"
          :text="item.hint"
          :link-url="item.hintUrl"
          :link-label="item.hintLinkLabel"
          icon="info"
          side="right"
          @pointerdown.stop
          @pointerup.stop
          @click.stop
          @keydown.enter.stop
          @keydown.space.stop
        />
      </MenuAction>
    </template>
  </Menu>
</template>
