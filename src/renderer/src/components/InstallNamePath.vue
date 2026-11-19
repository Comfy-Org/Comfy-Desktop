<script setup lang="ts">
import Input from '@comfyorg/design-system/input/Input'
import Button from '@comfyorg/design-system/button/Button'
import type { PathIssue, DiskSpaceInfo } from '../types/ipc'
import PathDiskInfo from './PathDiskInfo.vue'
import { revealInFolderKey } from '../composables/usePlatform'

const revealFolderKey = revealInFolderKey(window.api?.platform)

defineProps<{
  name: string
  path: string
  defaultPath: string
  hideInstallPath?: boolean
  pathIssues: PathIssue[]
  diskSpaceLoading: boolean
  diskSpace: DiskSpaceInfo | null
  estimatedSize: number
}>()

defineEmits<{
  'update:name': [value: string]
  'update:path': [value: string]
  browse: []
  open: []
}>()
</script>

<template>
  <div class="install-name-field mt-4 flex flex-col">
    <label class="text-[14px] text-text-muted" for="inst-name">{{ $t('common.name') }}</label>
    <Input
      id="inst-name"
      :model-value="name"
      type="text"
      class="mt-1.5"
      :placeholder="$t('common.namePlaceholder')"
      @input="$emit('update:name', ($event.target as HTMLInputElement).value)"
    />
  </div>

  <div v-if="!hideInstallPath" class="install-name-field mt-4 flex flex-col">
    <label class="text-[14px] text-text-muted">{{ $t('newInstall.installLocation') }}</label>
    <div class="install-path-input mt-1.5 flex gap-2">
      <div
        class="path-open-wrap flex min-w-0 flex-1 items-center rounded-lg bg-secondary px-3 py-2"
      >
        <Button
          v-if="path"
          size="link"
          variant="link"
          type="button"
          class="path-open block min-w-0 max-w-full truncate py-0 text-left"
          :title="$t(revealFolderKey)"
          :aria-label="`${$t(revealFolderKey)}: ${path}`"
          @click="$emit('open')"
        >
          {{ path }}
        </Button>
      </div>
      <Button
        type="button"
        size="lg"
        variant="textonly"
        class="rounded-lg px-3 text-neutral-100 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.16)] hover:bg-white/6"
        @click="$emit('browse')"
        >{{ $t('common.browse') }}</Button
      >
      <Button
        v-if="path !== defaultPath"
        type="button"
        size="lg"
        variant="secondary"
        @click="$emit('update:path', defaultPath)"
      >
        {{ $t('common.resetDefault') }}
      </Button>
    </div>
    <PathDiskInfo
      :path-issues="pathIssues"
      :disk-space-loading="diskSpaceLoading"
      :disk-space="diskSpace"
      :estimated-size="estimatedSize"
    />
  </div>
</template>
