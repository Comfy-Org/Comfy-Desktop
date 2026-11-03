<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import { TID } from '../../../../shared/testIds'
import type { ActionDef } from '../../types/ipc'

export type MenuAction = ActionDef & { icon?: Component }
const props = defineProps<{
  open: boolean
  actions: MenuAction[]
  heading?: string
  anchor?: HTMLElement | null
}>()
const emit = defineEmits<{ close: []; pick: [action: MenuAction] }>()
const visible = computed({
  get: () => props.open && props.actions.length > 0,
  set: (open: boolean) => {
    if (!open) emit('close')
  }
})
const hasIcons = computed(() => props.actions.some((action) => !!action.icon))
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
  // The parent trigger toggles open on click. Let it own that click, so the
  // dismiss layer cannot close on pointerdown and then reopen on click.
  if (target instanceof Node && props.anchor?.contains(target)) {
    event.preventDefault()
    return
  }
  restoreFocus.value = false
}
function onCloseAutoFocus(event: Event): void {
  event.preventDefault()
  if (restoreFocus.value) props.anchor?.focus()
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
    :aria-label="heading || $t('comfyUISettings.more', 'More')"
    side="top"
    align="end"
    :side-offset="6"
    class="more-menu z-62 min-w-[200px] max-w-[280px]"
    :class="{ 'has-heading': !!heading, 'has-icons': hasIcons }"
    @interact-outside="onInteractOutside"
    @close-auto-focus="onCloseAutoFocus"
  >
    <template #trigger><span hidden aria-hidden="true" /></template>
    <MenuItem
      v-for="action in actions"
      :key="action.id"
      as="button"
      type="button"
      :disabled="action.enabled === false"
      class="more-menu-item w-full justify-start text-left"
      :class="{
        'is-danger text-destructive': action.style === 'danger',
        'is-disabled': action.enabled === false
      }"
      :data-testid="TID.pinBottomAction(action.id)"
      @select="handlePick(action)"
    >
      <span
        v-if="hasIcons"
        class="more-menu-item-icon inline-flex size-4 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <component :is="action.icon" v-if="action.icon" :size="15" />
      </span>
      <span class="more-menu-item-label flex-auto">{{ action.label }}</span>
    </MenuItem>
  </Menu>
</template>
