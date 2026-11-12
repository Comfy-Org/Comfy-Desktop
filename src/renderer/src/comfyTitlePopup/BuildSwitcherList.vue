<script setup lang="ts">
import { computed, nextTick, onMounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { installTypeMetaForInstall } from '../lib/installTypeIcon'
import type { Installation } from '../types/ipc'

interface BuildListSnapshot {
  installs: unknown[]
  activeInstallationId: string | null
  runningInstallationIds: string[]
}

interface BuildListBridge {
  pickInstall: (installationId: string) => void
  close?: () => void
}

const { snapshot } = defineProps<{ snapshot: BuildListSnapshot }>()

const { t } = useI18n()
const list = useTemplateRef<HTMLElement>('list')
const bridge = (window as unknown as { __comfyTitlePopup?: BuildListBridge }).__comfyTitlePopup

const builds = computed(() => snapshot.installs as Installation[])
const running = computed(() => new Set(snapshot.runningInstallationIds))

function rows(): HTMLElement[] {
  return Array.from(list.value?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
}

async function focusCurrent(): Promise<void> {
  await nextTick()
  const all = rows()
  ;(all.find((row) => row.getAttribute('aria-selected') === 'true') ?? all[0])?.focus()
}

function moveFocus(step: number): void {
  const all = rows()
  if (all.length === 0) return
  const at = all.indexOf(document.activeElement as HTMLElement)
  const from = at === -1 ? (step > 0 ? -1 : 0) : at
  all[(from + step + all.length) % all.length]?.focus()
}

function pick(build: Installation): void {
  if (build.id === snapshot.activeInstallationId) {
    bridge?.close?.()
    return
  }
  bridge?.pickInstall(build.id)
}

onMounted(focusCurrent)
watch([() => snapshot.activeInstallationId, () => builds.value.length > 0], focusCurrent)
</script>

<template>
  <div class="flex size-full box-border flex-col overflow-hidden py-1.5" data-testid="build-list">
    <div
      id="build-list-title"
      class="px-3 pt-1 pb-2 text-xs font-medium tracking-wide text-subtle-foreground uppercase"
    >
      {{ t('instancePicker.instances') }}
    </div>
    <div
      ref="list"
      class="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1.5"
      role="listbox"
      aria-labelledby="build-list-title"
      @keydown.down.prevent="moveFocus(1)"
      @keydown.up.prevent="moveFocus(-1)"
    >
      <button
        v-for="build in builds"
        :key="build.id"
        type="button"
        role="option"
        :aria-selected="build.id === snapshot.activeInstallationId"
        class="flex h-9 w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-control px-2 text-left text-ui text-foreground outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
        :class="build.id === snapshot.activeInstallationId && 'bg-accent/60'"
        :data-testid="`build-list-${build.id}`"
        @click="pick(build)"
      >
        <component
          :is="installTypeMetaForInstall(build).icon"
          :size="15"
          class="shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 truncate">{{ build.name }}</span>
        <span
          v-if="running.has(build.id)"
          class="size-1.5 shrink-0 rounded-full bg-success"
          role="img"
          :aria-label="t('instancePicker.running')"
        />
      </button>
    </div>
  </div>
</template>
