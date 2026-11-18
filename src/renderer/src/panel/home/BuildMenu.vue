<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
  type ComponentPublicInstance
} from 'vue'
import { useI18n } from 'vue-i18n'
import { Trash2, X } from '@lucide/vue'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import { useBuildMenu } from './useBuildMenu'
import type { Installation } from '../../types/ipc'

export interface BuildMenuAnchor {
  getBoundingClientRect: () => DOMRect
}

const {
  build,
  anchor,
  align = 'start',
  returnFocus = null
} = defineProps<{
  build: Installation
  anchor: BuildMenuAnchor
  align?: 'start' | 'end'
  returnFocus?: HTMLElement | null
}>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const { items, run } = useBuildMenu(() => build)
const confirmingUninstall = ref(false)
const confirmUninstallItem = useTemplateRef<ComponentPublicInstance>('confirmUninstallItem')

const reference = computed(() => anchor)

const itemsKey = computed(() =>
  items.value.map((item) => `${item.id}${item.disabled ? '!' : ''}`).join()
)
const canUninstall = computed(() =>
  items.value.some((item) => item.id === 'delete' && !item.disabled)
)

watch([open, () => build.id, itemsKey], () => {
  confirmingUninstall.value = false
})

function select(event: Event, id: string): void {
  if (id === 'delete') {
    event.preventDefault()
    confirmingUninstall.value = true
    void nextTick(() =>
      (confirmUninstallItem.value?.$el as HTMLElement | undefined)?.focus({ preventScroll: true })
    )
    return
  }
  void run(id)
}

function confirmUninstall(event: Event): void {
  if (!canUninstall.value) {
    event.preventDefault()
    confirmingUninstall.value = false
    return
  }
  void run('delete', { confirmed: true })
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
    :align="align"
    :collision-padding="4"
    :side-offset="4"
    class="z-[10000] w-[232px]"
    data-testid="build-menu"
    :data-build-id="build.id"
    @keydown.capture="onKeydown"
    @close-auto-focus="onCloseAutoFocus"
  >
    <template #trigger><span hidden aria-hidden="true" /></template>
    <template v-if="confirmingUninstall">
      <div
        class="flex flex-col gap-1 px-3 py-1.5 text-xs/4 whitespace-normal"
        role="presentation"
        data-testid="build-menu-uninstall-question"
      >
        <span class="truncate font-medium text-foreground">{{ build.name }}</span>
        <span class="text-muted-foreground">{{ t('actions.deleteConfirmMessage') }}</span>
      </div>
      <MenuItem
        ref="confirmUninstallItem"
        class="text-destructive focus:text-destructive"
        :text-value="t('actions.delete')"
        data-testid="build-menu-confirm-uninstall"
        @select="confirmUninstall"
      >
        <Trash2 :size="15" class="shrink-0" aria-hidden="true" />
        {{ t('actions.delete') }}
      </MenuItem>
      <MenuItem :text-value="t('common.cancel')" data-testid="build-menu-keep">
        <X :size="15" class="shrink-0" aria-hidden="true" />
        {{ t('common.cancel') }}
      </MenuItem>
    </template>
    <template v-else>
      <template v-for="item in items" :key="item.id">
        <MenuSeparator v-if="item.separator" />
        <MenuItem
          :class="item.danger && 'text-destructive focus:text-destructive'"
          :disabled="item.disabled"
          :text-value="item.label"
          :title="item.disabled ? item.title : item.hint"
          :data-testid="`build-menu-${item.id}`"
          @select="select($event, item.id)"
        >
          <component
            :is="item.icon"
            v-if="item.icon"
            :size="15"
            class="shrink-0"
            aria-hidden="true"
          />
          {{ item.label }}
        </MenuItem>
      </template>
    </template>
  </Menu>
</template>
