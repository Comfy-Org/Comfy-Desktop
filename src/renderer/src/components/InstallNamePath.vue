<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import type { PathIssue, DiskSpaceInfo } from '../types/ipc'
import PathDiskInfo from './PathDiskInfo.vue'

const buttonClass =
  'static block shrink-0 appearance-auto rounded-lg border border-solid border-[var(--border)] bg-surface px-4 py-2 font-sans text-[14px] leading-[inherit] font-normal whitespace-normal text-text touch-auto transition-none [&]:[appearance:button] hover:bg-[var(--border)] focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto]'

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
    <input
      id="inst-name"
      :value="name"
      type="text"
      class="mt-1.5 w-full rounded-md border border-solid border-[var(--border)] bg-surface px-2.5 py-2 text-[14px] text-text outline-none focus:border-[var(--accent)]"
      :placeholder="$t('common.namePlaceholder')"
      @input="$emit('update:name', ($event.target as HTMLInputElement).value)"
    />
  </div>

  <div v-if="!hideInstallPath" class="install-name-field mt-4 flex flex-col">
    <label class="text-[14px] text-text-muted">{{ $t('newInstall.installLocation') }}</label>
    <div class="install-path-input mt-1.5 flex gap-2">
      <div
        class="path-open-wrap mt-1.5 flex min-w-0 flex-1 items-center rounded-md border border-solid border-[var(--border)] bg-surface px-2.5 py-2"
      >
        <Button
          v-if="path"
          size="unset"
          variant="textonly"
          type="button"
          class="path-open static block min-w-0 max-w-full shrink-0 appearance-auto overflow-hidden rounded-lg border-0 bg-transparent p-0 text-left font-sans text-[14px] leading-[inherit] font-normal text-ellipsis whitespace-nowrap text-text touch-auto transition-none [&]:[appearance:button] hover:bg-transparent hover:text-[var(--accent)] hover:underline focus-visible:bg-transparent focus-visible:text-[var(--accent)] focus-visible:underline focus-visible:ring-0 focus-visible:outline-none"
          :title="$t('actions.openDirectory', 'Open Directory')"
          :aria-label="`${$t('actions.openDirectory', 'Open Directory')}: ${path}`"
          @click="$emit('open')"
        >
          {{ path }}
        </Button>
      </div>
      <Button size="unset" variant="textonly" :class="buttonClass" @click="$emit('browse')">{{
        $t('common.browse')
      }}</Button>
      <Button
        v-if="path !== defaultPath"
        size="unset"
        variant="textonly"
        :class="buttonClass"
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
