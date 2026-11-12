<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy, EllipsisVertical, FolderSearch } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import { revealInFolderKey } from '../composables/usePlatform'

const COPIED_CLOSE_MS = 900
const COPY_LABEL_KEYS = {
  idle: 'assets.local.copyPath',
  copied: 'assets.local.pathCopied',
  failed: 'assets.local.copyFailed'
} as const

const props = defineProps<{
  path: string
  triggerTestId: string
}>()

const { t } = useI18n()
const revealKey = revealInFolderKey(window.api.platform)
const open = ref(false)
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
let closeTimer: ReturnType<typeof setTimeout> | null = null

function clearCloseTimer(): void {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = null
}

function reveal(): void {
  window.api.revealPath(props.path)
}

async function copyPath(event: Event): Promise<void> {
  event.preventDefault()
  copyState.value = await navigator.clipboard.writeText(props.path).then(
    () => 'copied' as const,
    () => 'failed' as const
  )
  clearCloseTimer()
  closeTimer = setTimeout(() => (open.value = false), COPIED_CLOSE_MS)
}

watch(open, (isOpen) => {
  if (isOpen) return
  clearCloseTimer()
  copyState.value = 'idle'
})

onBeforeUnmount(clearCloseTimer)
</script>

<template>
  <Menu
    v-model:open="open"
    :modal="false"
    align="end"
    class="z-20 min-w-[180px]"
    :aria-label="t('assets.local.folderActions')"
  >
    <template #trigger>
      <Button
        type="button"
        variant="muted-textonly"
        size="icon"
        class="relative z-10 shrink-0"
        :aria-label="t('assets.local.folderActions')"
        :title="t('assets.local.folderActions')"
        :data-testid="triggerTestId"
      >
        <EllipsisVertical :size="16" aria-hidden="true" />
      </Button>
    </template>
    <MenuItem
      as="button"
      type="button"
      class="w-full"
      data-testid="local-folder-reveal"
      @select="reveal"
    >
      <FolderSearch :size="15" aria-hidden="true" />
      <span class="flex-1 text-left">{{ t(revealKey) }}</span>
    </MenuItem>
    <MenuItem
      as="button"
      type="button"
      class="w-full"
      data-testid="local-folder-copy-path"
      @select="copyPath"
    >
      <Check v-if="copyState === 'copied'" :size="15" aria-hidden="true" />
      <Copy v-else :size="15" aria-hidden="true" />
      <span class="flex-1 text-left" aria-live="polite">{{ t(COPY_LABEL_KEYS[copyState]) }}</span>
    </MenuItem>
  </Menu>
</template>
