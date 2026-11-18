<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import DesktopDialogSurface from '../components/ui/DesktopDialogSurface.vue'
import { isCompatibleLocalWorkflowBuild } from '../../../shared/catalogWorkflowCompatibility'
import { isComfyCloud } from './home/homeBuild'
import type { CatalogWorkflow, CatalogWorkflowTarget, Installation } from '../types/ipc'

const props = defineProps<{
  workflow: CatalogWorkflow
  installations: Installation[]
  workspaceId: string
}>()

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

interface BuildChoice {
  key: string
  label: string
  target: CatalogWorkflowTarget
}

const options = computed<BuildChoice[]>(() => {
  const { workflow, installations } = props
  const choices: BuildChoice[] = []
  if (workflow.canOpenLocal) {
    for (const build of installations) {
      if (!isCompatibleLocalWorkflowBuild(build, workflow.minComfyUIVersion)) continue
      choices.push({
        key: `local:${build.id}`,
        label: build.name,
        target: { where: 'local', build: build.id }
      })
    }
  }
  const cloud = installations.find(isComfyCloud)
  if (workflow.canOpenCloud && cloud) {
    choices.push({ key: 'cloud', label: cloud.name, target: { where: 'cloud' } })
  }
  return choices
})

const noCompatibleLocalBuild = computed(
  () =>
    props.workflow.canOpenLocal && !options.value.some((choice) => choice.target.where === 'local')
)
const needsUpdate = computed(
  () =>
    noCompatibleLocalBuild.value &&
    props.workflow.minComfyUIVersion &&
    props.installations.some((build) => isCompatibleLocalWorkflowBuild(build, null))
)
const pickedKey = ref('')
const pending = ref(false)
const error = ref('')
const selectedChoice = computed(
  () => options.value.find((choice) => choice.key === pickedKey.value) ?? options.value[0]
)
const selectedKey = computed({
  get: () => selectedChoice.value?.key ?? '',
  set: (key: string) => {
    pickedKey.value = key
    error.value = ''
  }
})

async function openInComfyUI(): Promise<void> {
  const target = selectedChoice.value?.target
  if (pending.value || !target) return
  pending.value = true
  error.value = ''
  try {
    const result = await window.api.launchCatalogWorkflow(
      props.workflow.id,
      target,
      props.workspaceId
    )
    if (result.opened) emit('close')
    else error.value = result.error || t('workflowLaunch.openFailed')
  } catch {
    error.value = t('workflowLaunch.openFailed')
  } finally {
    pending.value = false
  }
}

async function openOnHub(): Promise<void> {
  if (pending.value) return
  pending.value = true
  error.value = ''
  try {
    if (await window.api.openCatalogWorkflow(props.workflow.id)) emit('close')
    else error.value = t('workflowLaunch.hubFailed')
  } catch {
    error.value = t('workflowLaunch.hubFailed')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <DesktopDialogSurface
    :open="true"
    :aria-label="workflow.title"
    :dismiss-on-escape="!pending"
    :dismiss-on-outside="!pending"
    overlay-class="fixed inset-0 z-50 grid place-items-center bg-[var(--overlay-bg)] p-6"
    content-class="w-full max-w-[min(100%,480px)] max-h-full overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg)] p-6 text-[var(--text)]"
    @close="emit('close')"
  >
    <h2 class="m-0 wrap-anywhere text-xl font-semibold">{{ workflow.title }}</h2>
    <p v-if="workflow.description" class="mt-2 wrap-anywhere text-sm text-muted-foreground">
      {{ workflow.description }}
    </p>

    <form class="mt-5 flex flex-col gap-4" @submit.prevent="openInComfyUI">
      <label v-if="options.length" class="flex flex-col gap-2 text-sm font-medium">
        {{ t('workflowLaunch.target') }}
        <select
          v-model="selectedKey"
          class="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus-visible:outline-2 disabled:opacity-60"
          data-initial-focus
          data-testid="catalog-workflow-target"
          :disabled="pending"
        >
          <option v-for="choice in options" :key="choice.key" :value="choice.key">
            {{ choice.label }}
          </option>
        </select>
      </label>
      <p v-if="needsUpdate" class="m-0 text-sm text-muted-foreground">
        {{ t('workflowLaunch.updateBuild', { version: workflow.minComfyUIVersion }) }}
      </p>
      <p v-else-if="noCompatibleLocalBuild" class="m-0 text-sm text-muted-foreground">
        {{ t('workflowLaunch.noLocalBuild') }}
      </p>
      <p v-else-if="!options.length" class="m-0 text-sm text-muted-foreground">
        {{ t('workflowLaunch.unavailable') }}
      </p>
      <p v-if="error" role="alert" class="m-0 wrap-anywhere text-sm text-destructive">
        {{ error }}
      </p>

      <footer class="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="textonly" :disabled="pending" @click="emit('close')">
          {{ t('common.cancel') }}
        </Button>
        <Button type="button" variant="secondary" :disabled="pending" @click="openOnHub">
          {{ t('workflowLaunch.openHub') }}
        </Button>
        <Button v-if="options.length" type="submit" variant="inverted" :disabled="pending">
          {{ pending ? t('workflowLaunch.opening') : t('workflowLaunch.openComfyUI') }}
        </Button>
      </footer>
    </form>
  </DesktopDialogSurface>
</template>
