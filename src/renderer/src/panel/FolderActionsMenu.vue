<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { EllipsisVertical, FolderSearch } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import { revealInFolderKey } from '../composables/usePlatform'

const { path, triggerTestId } = defineProps<{
  path: string
  triggerTestId: string
}>()

const { t } = useI18n()
const revealKey = revealInFolderKey(window.api.platform)

function reveal(): void {
  window.api.revealPath(path)
}
</script>

<template>
  <Menu
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
  </Menu>
</template>
