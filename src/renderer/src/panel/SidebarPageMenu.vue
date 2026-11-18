<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ExternalLink } from '@lucide/vue'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import type { BuildMenuAnchor } from './home/BuildMenu.vue'
import type { NewWindowDashboardPage } from '../../../shared/dashboardPages'

const {
  page,
  anchor,
  returnFocus = null
} = defineProps<{
  page: NewWindowDashboardPage
  anchor: BuildMenuAnchor
  returnFocus?: HTMLElement | null
}>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()

const reference = computed(() => anchor)

function openInNewWindow(): void {
  window.api.openPageInNewWindow(page)
}

function onCloseAutoFocus(event: Event): void {
  if (!returnFocus?.isConnected) return
  event.preventDefault()
  returnFocus.focus({ preventScroll: true })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  open.value = false
}

function onWindowBlur(): void {
  if (open.value) open.value = false
}
onMounted(() => window.addEventListener('blur', onWindowBlur))
onBeforeUnmount(() => window.removeEventListener('blur', onWindowBlur))
</script>

<template>
  <Menu
    v-model:open="open"
    :modal="false"
    :reference="reference"
    align="start"
    :collision-padding="4"
    :side-offset="4"
    class="z-[10000] w-[232px]"
    data-testid="sidebar-page-menu"
    :data-page="page"
    @keydown.capture="onKeydown"
    @close-auto-focus="onCloseAutoFocus"
  >
    <template #trigger><span hidden aria-hidden="true" /></template>
    <MenuItem
      :text-value="t('sidebar.openInNewWindow')"
      data-testid="sidebar-page-menu-new-window"
      @select="openInNewWindow"
    >
      <ExternalLink :size="15" class="shrink-0" aria-hidden="true" />
      {{ t('sidebar.openInNewWindow') }}
    </MenuItem>
  </Menu>
</template>
