<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener, useOnline, useResizeObserver } from '@vueuse/core'
import {
  BookOpen,
  Check,
  ChevronDown,
  CircleCheck,
  Cloud,
  Download,
  Laptop,
  Link2,
  Package,
  X
} from '@lucide/vue'
import { DropdownMenuRadioGroup } from 'reka-ui'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import DesktopDialogSurface from '../components/ui/DesktopDialogSurface.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import type { LocalBuildVersions } from '../../../shared/catalogWorkflowCompatibility'
import { useAuthStore } from '../stores/authStore'
import { useSessionStore } from '../stores/sessionStore'
import type {
  CatalogWorkflow,
  CatalogWorkflowDownload,
  CatalogWorkflowModel,
  CatalogWorkflowNeeds,
  Installation
} from '../types/ipc'
import WorkflowGraphPreview from './WorkflowGraphPreview.vue'
import WorkflowResultPreview from './WorkflowResultPreview.vue'
import { formatBytes, useWorkflowLabels } from './useWorkflowLabels'
import {
  bestChoice,
  knownBytes,
  modelKey,
  targetChoices,
  type TargetChoice
} from './workflowTargets'

type PreviewTab = 'result' | 'graph'
type Zoom = 'fit' | number

const ZOOM_OPTIONS: readonly Zoom[] = ['fit', 50, 100, 200]
const CAPTION = 'm-0 text-[11px]/4 font-medium tracking-[0.08em] text-subtle-foreground uppercase'
const BOX = 'rounded-[10px] bg-[rgb(31_31_31)]'

const props = defineProps<{
  workflow: CatalogWorkflow
  installations: Installation[]
  workspaceId: string
}>()

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const labels = useWorkflowLabels()
const authStore = useAuthStore()
const sessionStore = useSessionStore()
const online = useOnline()

const tab = ref<PreviewTab>('result')
const zoom = ref<Zoom>('fit')
const shownPercent = ref<number | null>(null)
const versions = ref<LocalBuildVersions>({})
const needs = ref<CatalogWorkflowNeeds | null | undefined>(undefined)
const pickedKey = ref<string | null>(null)
const pending = ref(false)
const error = ref('')
const progress = ref<CatalogWorkflowDownload | null>(null)
const aboutOpen = ref(false)
const needsOpen = ref(false)
const linkCopied = ref(false)
let stopProgress: (() => void) | null = null
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const tabs = computed(() => [
  { value: 'result' as const, label: t('workflowLaunch.result'), testId: 'workflow-tab-result' },
  { value: 'graph' as const, label: t('workflowLaunch.graph'), testId: 'workflow-tab-graph' }
])

const media = computed(() => props.workflow.media[0] ?? null)
const fallbackMedia = computed(() =>
  props.workflow.thumbnailUrl
    ? { url: props.workflow.thumbnailUrl, kind: 'image' as const, width: null, height: null }
    : null
)
const tutorialHost = computed(() =>
  props.workflow.tutorialUrl ? new URL(props.workflow.tutorialUrl).hostname : ''
)
const about = computed(() => props.workflow.longDescription ?? props.workflow.description)
const partnerOnly = computed(
  () => props.workflow.license === 'partner' && !props.workflow.canOpenLocal
)
const aboutText = ref<HTMLElement | null>(null)
const aboutOverflows = ref(false)
useResizeObserver(aboutText, () => {
  const element = aboutText.value
  if (element && !aboutOpen.value) {
    aboutOverflows.value = element.scrollHeight > element.clientHeight + 1
  }
})

const choices = computed(() =>
  targetChoices({
    workflow: props.workflow,
    installations: props.installations,
    versions: versions.value,
    needs: needs.value,
    isRunning: (id) => sessionStore.isRunning(id),
    signedIn: authStore.isSignedIn,
    online: online.value
  })
)
const selected = computed<TargetChoice | null>(
  () =>
    choices.value.find((choice) => choice.key === pickedKey.value && !choice.disabled) ??
    bestChoice(choices.value)
)

const models = computed(() => needs.value?.models ?? [])
const totalBytes = computed(() => knownBytes(models.value))
const shown = computed(() => selected.value ?? choices.value[0] ?? null)
const missingBytes = computed(() => (selected.value ? knownBytes(selected.value.missing) : null))

function choiceStatus(choice: TargetChoice): string {
  switch (choice.state) {
    case 'outdated':
      return t('workflowLaunch.status.outdated', {
        version: props.workflow.minComfyUIVersion ?? ''
      })
    case 'not-on-cloud':
      return t('workflowLaunch.status.notOnCloud')
    case 'offline':
      return t('workflowLaunch.status.offline')
    case 'signed-out':
      return t('workflowLaunch.status.signedOut')
    case 'cloud-ready':
      return t('workflowLaunch.status.cloudReady')
  }
  const run = choice.running
    ? t('workflowLaunch.status.running')
    : t('workflowLaunch.status.stopped')
  if (choice.state === 'checking') return `${run} · ${t('workflowLaunch.status.checking')}`
  if (choice.state === 'unchecked') return `${run} · ${t('workflowLaunch.status.unchecked')}`
  if (choice.state === 'ready') return `${run} · ${t('workflowLaunch.status.everyModel')}`
  return `${run} · ${t('workflowLaunch.status.missing', { count: choice.missing.length }, choice.missing.length)}`
}

function choiceSize(choice: TargetChoice): string | null {
  const bytes = choice.state === 'missing' ? knownBytes(choice.missing) : null
  return bytes === null ? null : formatBytes(bytes)
}

const needsSummary = computed(() => {
  if (partnerOnly.value) return t('workflowLaunch.needs.partner')
  if (needs.value === undefined) return t('workflowLaunch.needs.checking')
  if (needs.value === null) return t('workflowLaunch.needs.failed')
  if (models.value.length === 0) return t('workflowLaunch.needs.none')
  const count = t(
    'workflowLaunch.needs.models',
    { count: models.value.length },
    models.value.length
  )
  return totalBytes.value === null ? count : `${count} · ${formatBytes(totalBytes.value)}`
})

const needsState = computed<'installed' | 'downloads' | 'cloud' | null>(() => {
  const choice = selected.value
  if (!choice || models.value.length === 0) return null
  if (choice.where === 'cloud') return 'cloud'
  if (choice.state === 'missing') return 'downloads'
  return choice.state === 'ready' ? 'installed' : null
})

function modelMissing(wanted: CatalogWorkflowModel): boolean {
  const key = modelKey(wanted)
  return selected.value?.missing.some((model) => modelKey(model) === key) ?? false
}

const action = computed<{ label: string; disabled: boolean; run: () => void }>(() => {
  const choice = selected.value
  if (!choice) return { label: t('workflowLaunch.openHub'), disabled: false, run: openOnHub }
  if (choice.where === 'cloud') {
    if (choice.state === 'signed-out') {
      return { label: t('workflowLaunch.action.logIn'), disabled: false, run: logIn }
    }
    return {
      label: t('workflowLaunch.action.runOnCloud'),
      disabled: choice.state === 'offline',
      run: () => void launch(choice)
    }
  }
  const name = choice.build.name
  if (choice.state === 'missing') {
    return {
      label: t('workflowLaunch.action.downloadAndLaunch'),
      disabled: false,
      run: () => void launch(choice)
    }
  }
  return {
    label: choice.running
      ? t('workflowLaunch.action.openIn', { name })
      : t('workflowLaunch.action.launch', { name }),
    disabled: choice.state === 'checking' || choice.state === 'unchecked',
    run: () => void launch(choice)
  }
})

const note = computed(() => {
  const choice = selected.value
  if (!choice) return t('workflowLaunch.noTarget')
  if (choice.state === 'signed-out') return t('workflowLaunch.note.freeCredits')
  if (choice.state === 'offline') return t('workflowLaunch.note.offline')
  if (choice.state === 'missing') {
    return missingBytes.value === null
      ? t(
          'workflowLaunch.note.downloadModels',
          { count: choice.missing.length, name: choice.build.name },
          choice.missing.length
        )
      : t('workflowLaunch.note.downloadBytes', {
          size: formatBytes(missingBytes.value),
          name: choice.build.name
        })
  }
  return ''
})

const progressLabel = computed(() => {
  const current = progress.value
  if (!current || current.totalBytes <= 0) return t('workflowLaunch.action.downloading')
  return t('workflowLaunch.action.downloadingBytes', {
    done: formatBytes(current.receivedBytes),
    total: formatBytes(current.totalBytes)
  })
})
const progressPercent = computed(() => {
  const current = progress.value
  return current && current.totalBytes > 0
    ? Math.min(100, (current.receivedBytes / current.totalBytes) * 100)
    : 0
})

async function loadNeeds(): Promise<void> {
  needs.value = undefined
  needs.value = await window.api.catalogWorkflowNeeds(props.workflow.id).catch(() => null)
}

async function launch(choice: TargetChoice): Promise<void> {
  if (pending.value) return
  pickedKey.value = choice.key
  pending.value = true
  error.value = ''
  progress.value = null
  try {
    const target =
      choice.where === 'cloud'
        ? ({ where: 'cloud' } as const)
        : ({ where: 'local', build: choice.build.id } as const)
    const result = await window.api.launchCatalogWorkflow(
      props.workflow.id,
      target,
      props.workspaceId,
      { downloadMissing: choice.state === 'missing' }
    )
    if (result.opened) emit('close')
    else {
      error.value = result.error || t('workflowLaunch.openFailed')
      if (choice.state === 'missing') void loadNeeds()
    }
  } catch {
    error.value = t('workflowLaunch.openFailed')
  } finally {
    pending.value = false
    progress.value = null
  }
}

function openTutorial(): void {
  if (props.workflow.tutorialUrl) void window.api.openExternal(props.workflow.tutorialUrl)
}

function logIn(): void {
  void authStore.signIn().catch(() => {})
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

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.workflow.hubUrl)
    linkCopied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (linkCopied.value = false), 1800)
  } catch {
    linkCopied.value = false
  }
}

function zoomLabel(value: Zoom): string {
  return value === 'fit' ? t('workflowLaunch.zoomFit') : `${value}%`
}

watch(
  () => props.workspaceId,
  () => {
    pickedKey.value = null
    error.value = ''
  }
)

watch(tab, () => {
  zoom.value = 'fit'
})

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || event.defaultPrevented || pending.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, input, textarea, [role="menu"], [role="menuitem"]')) return
  if (action.value.disabled) return
  event.preventDefault()
  action.value.run()
})

onMounted(async () => {
  stopProgress = window.api.onCatalogWorkflowDownload((update) => {
    if (update.id === props.workflow.id && selected.value?.build.id === update.build) {
      progress.value = update
    }
  })
  void loadNeeds()
  versions.value = await window.api.catalogLocalBuildVersions().catch(() => ({}))
})

onBeforeUnmount(() => {
  stopProgress?.()
  clearTimeout(copiedTimer)
})
</script>

<template>
  <DesktopDialogSurface
    :open="true"
    :aria-label="workflow.title"
    :dismiss-on-escape="!pending"
    :dismiss-on-outside="!pending"
    overlay-class="fixed inset-0 z-50 grid place-items-center bg-[var(--overlay-bg)] px-16 py-6"
    content-class="rounded-[20px] bg-[rgb(9_9_9)] p-0 text-foreground shadow-2xl ring-1 ring-white/10 outline-none"
    data-testid="catalog-workflow-dialog"
    @close="emit('close')"
  >
    <div
      class="relative flex h-[666px] max-h-[calc(100vh-3rem)] w-[1037px] max-w-[calc(100vw-8rem)]"
    >
      <button
        type="button"
        class="absolute top-0 -right-12 grid size-9 place-items-center rounded-full border-0 bg-white/10 text-foreground outline-none hover:bg-white/16 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        :aria-label="t('close')"
        :disabled="pending"
        data-testid="catalog-workflow-close"
        @click="emit('close')"
      >
        <X :size="18" aria-hidden="true" />
      </button>

      <section class="relative flex min-w-0 flex-1 flex-col px-8 pt-[18px] pb-5">
        <header class="flex h-8 items-center">
          <SegmentedControl v-model="tab" :options="tabs" :label="t('workflowLaunch.preview')" />
        </header>
        <div class="mt-3.5 min-h-0 flex-1">
          <WorkflowResultPreview
            v-if="tab === 'result'"
            :media="media ?? fallbackMedia"
            :poster="workflow.thumbnailUrl"
            :zoom="zoom"
            @scale="shownPercent = $event"
          >
            <p class="m-0 text-ui text-muted-foreground">{{ t('workflowLaunch.noPreview') }}</p>
          </WorkflowResultPreview>
          <WorkflowGraphPreview
            v-else
            :graph="needs?.graph ?? null"
            :zoom="zoom"
            @scale="shownPercent = $event"
          >
            <div class="grid size-full place-items-center">
              <Skeleton v-if="needs === undefined" class="h-60 w-96 rounded-[10px]" />
              <p
                v-else
                class="m-0 text-ui text-muted-foreground"
                data-testid="workflow-graph-empty"
              >
                {{ t('workflowLaunch.noGraph') }}
              </p>
            </div>
          </WorkflowGraphPreview>
        </div>
        <div class="mt-2 flex h-[34px] justify-end">
          <Menu
            v-if="shownPercent !== null"
            :modal="false"
            align="end"
            side="top"
            :side-offset="6"
            class="z-[60] w-32"
            :aria-label="t('workflowLaunch.zoom')"
          >
            <template #trigger>
              <button
                type="button"
                class="flex h-[34px] items-center gap-1.5 rounded-[10px] border-0 bg-[rgb(16_16_16)] px-3 text-[13px] text-foreground tabular-nums outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="workflow-zoom"
              >
                {{ shownPercent }}%
                <ChevronDown :size="13" class="text-muted-foreground" aria-hidden="true" />
              </button>
            </template>
            <DropdownMenuRadioGroup
              :model-value="String(zoom)"
              class="flex flex-col gap-0.5"
              @update:model-value="zoom = $event === 'fit' ? 'fit' : Number($event)"
            >
              <MenuRadioItem
                v-for="value in ZOOM_OPTIONS"
                :key="value"
                :value="String(value)"
                :data-testid="`workflow-zoom-${value}`"
              >
                {{ zoomLabel(value) }}
              </MenuRadioItem>
            </DropdownMenuRadioGroup>
          </Menu>
        </div>
      </section>

      <aside
        class="m-2 ml-0 flex w-[380px] shrink-0 flex-col overflow-hidden rounded-[14px] bg-[rgb(20_20_20)]"
      >
        <div class="min-h-0 flex-1 overflow-y-auto">
          <header class="flex items-start gap-2 px-5 pt-[19px] pb-1.5">
            <div class="min-w-0 flex-1">
              <h2
                class="m-0 truncate text-[15px]/[21px] font-semibold"
                data-testid="workflow-title"
              >
                {{ workflow.title }}
              </h2>
              <p
                class="m-0 mt-1.5 flex min-w-0 items-center gap-1.5 text-[12px]/[18px] text-muted-foreground"
              >
                <span
                  v-if="workflow.author"
                  class="grid size-[18px] shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-semibold text-foreground uppercase"
                  aria-hidden="true"
                  >{{ workflow.author.slice(0, 1) }}</span
                >
                <span v-if="workflow.author" class="truncate">{{ workflow.author }}</span>
                <span
                  v-if="workflow.author && workflow.generationType"
                  class="size-[3px] shrink-0 rounded-full bg-current"
                  aria-hidden="true"
                />
                <span v-if="workflow.generationType" class="truncate">{{
                  labels.generation(workflow.generationType)
                }}</span>
              </p>
            </div>
            <button
              type="button"
              class="mt-[-3px] grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="
                linkCopied ? t('workflowLaunch.linkCopied') : t('workflowLaunch.copyLink')
              "
              :title="linkCopied ? t('workflowLaunch.linkCopied') : t('workflowLaunch.copyLink')"
              data-testid="workflow-copy-link"
              @click="copyLink"
            >
              <Check v-if="linkCopied" :size="15" aria-hidden="true" />
              <Link2 v-else :size="15" aria-hidden="true" />
            </button>
          </header>
          <p class="sr-only" aria-live="polite">
            {{ linkCopied ? t('workflowLaunch.linkCopied') : '' }}
          </p>

          <section v-if="about" class="px-5 py-2.5">
            <div
              class="rounded-[10px] bg-[rgb(30_30_30)] px-3 py-2.5 text-[12px]/[19px] text-muted-foreground"
            >
              <p
                ref="aboutText"
                class="m-0 whitespace-pre-line"
                :class="!aboutOpen && 'line-clamp-4'"
                data-testid="workflow-about"
              >
                {{ about }}
              </p>
              <button
                v-if="aboutOverflows || aboutOpen"
                type="button"
                class="mt-0.5 border-0 bg-transparent p-0 text-[12px]/[19px] text-foreground outline-none hover:underline focus-visible:underline"
                data-testid="workflow-about-more"
                @click="aboutOpen = !aboutOpen"
              >
                {{ aboutOpen ? t('workflowLaunch.less') : t('workflowLaunch.more') }}
              </button>
            </div>
          </section>

          <section class="px-5 py-2.5">
            <h3 :class="CAPTION">{{ t('workflowLaunch.openIn') }}</h3>
            <Menu
              v-if="choices.length > 0"
              :modal="false"
              align="start"
              :side-offset="6"
              class="z-[60] w-[340px]"
              :aria-label="t('workflowLaunch.openIn')"
            >
              <template #trigger>
                <button
                  type="button"
                  class="mt-2.5 flex h-[51px] w-full items-center gap-2.5 border-0 pr-5 pl-2 text-left outline-none hover:bg-[rgb(36_36_36)] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  :class="BOX"
                  :disabled="pending"
                  data-testid="catalog-workflow-target"
                >
                  <span
                    class="relative grid size-8 shrink-0 place-items-center rounded-lg bg-[rgb(46_46_46)]"
                  >
                    <component
                      :is="shown?.where === 'cloud' ? Cloud : Laptop"
                      :size="18"
                      aria-hidden="true"
                    />
                    <span
                      v-if="shown?.running"
                      class="absolute -right-1 -bottom-1 size-[9px] rounded-full bg-[rgb(89_211_140)] ring-2 ring-[rgb(31_31_31)]"
                      aria-hidden="true"
                    />
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-[13px]/[18px] text-foreground">{{
                      shown?.build.name
                    }}</span>
                    <span
                      class="truncate text-[12px]/4 text-muted-foreground"
                      data-testid="catalog-workflow-target-status"
                      >{{ shown ? choiceStatus(shown) : '' }}</span
                    >
                  </span>
                  <span
                    v-if="shown && choiceSize(shown)"
                    class="text-[12px] text-muted-foreground tabular-nums"
                  >
                    {{ choiceSize(shown) }}
                  </span>
                  <ChevronDown
                    :size="14"
                    class="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </template>
              <MenuItem
                v-for="choice in choices"
                :key="choice.key"
                class="h-auto items-center gap-2.5 py-1.5"
                :class="choice.key === selected?.key && 'bg-muted data-highlighted:bg-muted'"
                :disabled="choice.disabled"
                :data-testid="`catalog-workflow-target-${choice.key}`"
                @select="pickedKey = choice.key"
              >
                <component
                  :is="choice.where === 'cloud' ? Cloud : Laptop"
                  :size="15"
                  class="shrink-0"
                  aria-hidden="true"
                />
                <span class="flex min-w-0 flex-1 flex-col text-left">
                  <span class="truncate">{{ choice.build.name }}</span>
                  <span class="truncate text-[12px]/4 text-muted-foreground">{{
                    choiceStatus(choice)
                  }}</span>
                </span>
                <span
                  v-if="choiceSize(choice)"
                  class="text-[12px] text-muted-foreground tabular-nums"
                >
                  {{ choiceSize(choice) }}
                </span>
              </MenuItem>
            </Menu>
            <p
              v-else
              class="m-0 mt-2.5 text-[12px]/[19px] text-muted-foreground"
              data-testid="catalog-workflow-no-target"
            >
              {{ t('workflowLaunch.noLocalBuild') }}
            </p>
            <p
              v-if="partnerOnly"
              class="m-0 mt-2 flex items-center gap-1.5 text-[12px]/4 text-muted-foreground"
            >
              <CircleCheck :size="13" class="shrink-0 text-[rgb(89_211_140)]" aria-hidden="true" />
              {{ t('workflowLaunch.partnerOnly') }}
            </p>
          </section>

          <section class="px-5 py-2.5">
            <h3 :class="CAPTION">{{ t('workflowLaunch.whatItNeeds') }}</h3>
            <div class="mt-2.5" :class="BOX">
              <button
                type="button"
                class="flex h-10 w-full items-center gap-2 rounded-[10px] border-0 bg-transparent px-3 text-left outline-none hover:bg-white/4 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
                :disabled="models.length === 0 && needs !== null"
                :aria-expanded="needsOpen"
                data-testid="workflow-needs"
                @click="needs === null ? loadNeeds() : (needsOpen = !needsOpen)"
              >
                <span
                  class="min-w-0 flex-1 truncate text-[13px] text-foreground"
                  data-testid="workflow-needs-summary"
                >
                  {{ needsSummary }}
                </span>
                <span
                  v-if="needs === null"
                  class="text-[12px] text-foreground"
                  data-testid="workflow-needs-retry"
                  >{{ t('workflowLaunch.needs.retry') }}</span
                >
                <span
                  v-if="needsState"
                  class="text-[12px]"
                  :class="
                    needsState === 'installed' ? 'text-[rgb(89_211_140)]' : 'text-muted-foreground'
                  "
                  data-testid="workflow-needs-state"
                >
                  {{ t(`workflowLaunch.needs.state.${needsState}`) }}
                </span>
                <ChevronDown
                  v-if="models.length > 0"
                  :size="14"
                  class="shrink-0 text-muted-foreground transition-transform"
                  :class="needsOpen && 'rotate-180'"
                  aria-hidden="true"
                />
              </button>
              <ul
                v-if="needsOpen && models.length > 0"
                class="m-0 list-none bg-[rgb(20_20_20)] px-3 py-1 rounded-b-[10px]"
                data-testid="workflow-needs-list"
              >
                <li
                  v-for="model in models"
                  :key="`${model.directory}/${model.filename}`"
                  class="flex h-7 items-center gap-2 text-[12px]"
                >
                  <Package :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span
                    class="min-w-0 flex-1 truncate text-foreground"
                    :title="`${model.directory}/${model.filename}`"
                  >
                    {{ model.filename }}
                  </span>
                  <span v-if="model.sizeBytes !== null" class="text-muted-foreground tabular-nums">
                    {{ formatBytes(model.sizeBytes) }}
                  </span>
                  <Download
                    v-if="selected?.where === 'local' && modelMissing(model)"
                    :size="13"
                    class="shrink-0 text-muted-foreground"
                    :aria-label="t('workflowLaunch.needs.state.downloads')"
                  />
                  <Check
                    v-else
                    :size="13"
                    class="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </li>
              </ul>
            </div>
          </section>

          <section class="px-5 pt-2.5 pb-4">
            <h3 :class="CAPTION">{{ t('workflowLaunch.details') }}</h3>
            <dl
              class="m-0 mt-2.5 flex flex-col gap-1.5 text-[12px]/[17px]"
              data-testid="workflow-details"
            >
              <div v-if="workflow.author" class="flex justify-between gap-4">
                <dt class="text-muted-foreground">{{ t('workflowLaunch.detail.author') }}</dt>
                <dd class="m-0 truncate">{{ workflow.author }}</dd>
              </div>
              <div v-if="workflow.models.length" class="flex justify-between gap-4">
                <dt class="text-muted-foreground">{{ t('workflowLaunch.detail.model') }}</dt>
                <dd class="m-0 truncate">{{ workflow.models.join(', ') }}</dd>
              </div>
              <div v-if="workflow.uses !== null" class="flex justify-between gap-4">
                <dt class="text-muted-foreground">{{ t('workflowLaunch.detail.uses') }}</dt>
                <dd class="m-0 tabular-nums">{{ labels.count(workflow.uses) }}</dd>
              </div>
              <div v-if="workflow.license" class="flex justify-between gap-4">
                <dt class="text-muted-foreground">{{ t('workflowLaunch.detail.license') }}</dt>
                <dd class="m-0">{{ labels.license(workflow.license) }}</dd>
              </div>
              <div v-if="workflow.minComfyUIVersion" class="flex justify-between gap-4">
                <dt class="text-muted-foreground">{{ t('workflowLaunch.detail.comfyui') }}</dt>
                <dd class="m-0 tabular-nums">{{ workflow.minComfyUIVersion }}+</dd>
              </div>
              <div v-if="workflow.tutorialUrl" class="flex justify-between gap-4">
                <dt class="text-muted-foreground">{{ t('workflowLaunch.detail.tutorial') }}</dt>
                <dd class="m-0">
                  <a
                    :href="workflow.tutorialUrl"
                    class="inline-flex items-center gap-1 text-foreground no-underline hover:underline"
                    data-testid="workflow-tutorial"
                    @click.prevent="openTutorial"
                  >
                    <BookOpen :size="12" aria-hidden="true" />{{ tutorialHost }}
                  </a>
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <footer class="flex flex-col gap-2 px-5 pt-2 pb-4">
          <p
            v-if="error"
            role="alert"
            class="m-0 text-[12px]/[17px] wrap-anywhere text-destructive"
            data-testid="catalog-workflow-error"
          >
            {{ error }}
          </p>
          <p
            v-else-if="note"
            class="m-0 text-[12px]/[17px] text-muted-foreground"
            data-testid="catalog-workflow-note"
          >
            {{ note }}
          </p>
          <div
            v-if="pending && progress"
            class="relative h-9 overflow-hidden rounded-[10px] bg-[rgb(120_120_120)]"
            role="progressbar"
            :aria-valuenow="Math.round(progressPercent)"
            aria-valuemin="0"
            aria-valuemax="100"
            data-testid="catalog-workflow-progress"
          >
            <span
              class="absolute inset-y-0 left-0 bg-[rgb(220_220_220)]"
              :style="{ width: `${progressPercent}%` }"
            />
            <span
              class="relative grid h-full place-items-center text-[13px] font-medium text-[rgb(20_20_20)]"
            >
              {{ progressLabel }}
            </span>
          </div>
          <button
            v-else
            type="button"
            class="flex h-9 w-full items-center justify-center gap-2 rounded-[10px] border-0 bg-[rgb(240_240_240)] text-[13px] font-medium text-[rgb(20_20_20)] outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:bg-[rgb(120_120_120)] disabled:text-[rgb(40_40_40)]"
            :disabled="action.disabled || pending"
            data-testid="catalog-workflow-action"
            @click="action.run()"
          >
            {{ pending ? t('workflowLaunch.opening') : action.label }}
            <kbd
              v-if="!pending && !action.disabled"
              class="rounded-[5px] bg-[rgb(217_217_217)] px-1 font-[inherit] text-[11px]/4 text-[rgb(60_60_60)]"
              aria-hidden="true"
              >↵</kbd
            >
          </button>
        </footer>
      </aside>
    </div>
  </DesktopDialogSurface>
</template>
