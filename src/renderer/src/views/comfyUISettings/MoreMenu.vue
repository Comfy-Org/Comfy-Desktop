<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import { TID } from '../../../../shared/testIds'
import type { ActionDef } from '../../types/ipc'

export type MenuAction = ActionDef & { icon?: Component; separator?: boolean }
const props = defineProps<{
  open: boolean
  actions: MenuAction[]
  heading?: string
  anchor?: HTMLElement | null
  side?: 'top' | 'bottom'
}>()
const emit = defineEmits<{ close: []; pick: [action: MenuAction] }>()
const visible = computed({
  get: () => props.open && props.actions.length > 0,
  set: (open: boolean) => {
    if (!open) emit('close')
  }
})
const restoreFocus = ref(true)
watch(
  () => props.open,
  () => {
    restoreFocus.value = true
  }
)
function handlePick(action: MenuAction): void {
  if (action.enabled === false) return
  emit('pick', action)
  emit('close')
}
function onInteractOutside(event: Event): void {
  const target = (event as CustomEvent<{ originalEvent: Event }>).detail.originalEvent.target
  if (target instanceof Node && props.anchor?.contains(target)) {
    event.preventDefault()
    return
  }
  restoreFocus.value = false
}
function onCloseAutoFocus(event: Event): void {
  event.preventDefault()
  const active = document.activeElement
  const movedOn =
    active instanceof HTMLElement && active !== document.body && !active.closest('.more-menu')
  if (restoreFocus.value && !movedOn) props.anchor?.focus()
}
function onWindowBlur(): void {
  restoreFocus.value = false
  if (props.open) emit('close')
}
onMounted(() => window.addEventListener('blur', onWindowBlur))
onBeforeUnmount(() => window.removeEventListener('blur', onWindowBlur))
</script>

<template>
  <Menu
    v-model:open="visible"
    :modal="false"
    :reference="anchor ?? undefined"
    :label="heading"
    :aria-label="heading || $t('comfyUISettings.more')"
    :side="side ?? 'top'"
    align="end"
    :collision-padding="4"
    :side-offset="4"
    class="more-menu z-62 w-[232px]"
    @interact-outside="onInteractOutside"
    @close-auto-focus="onCloseAutoFocus"
  >
    <template #trigger><span hidden aria-hidden="true" /></template>
    <template v-for="(action, index) in actions" :key="action.id">
      <MenuSeparator v-if="action.separator && index > 0" />
      <MenuItem
        :disabled="action.enabled === false"
        :class="action.style === 'danger' && 'text-destructive focus:text-destructive'"
        :text-value="action.label"
        :data-testid="TID.pinBottomAction(action.id)"
        @select="handlePick(action)"
      >
        <component
          :is="action.icon"
          v-if="action.icon"
          :size="15"
          class="shrink-0"
          aria-hidden="true"
        />
        {{ action.label }}
      </MenuItem>
    </template>
  </Menu>
</template>
