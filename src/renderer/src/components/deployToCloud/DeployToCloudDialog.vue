<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, Copy, Info, Play, SquareArrowOutUpRight, X } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import Video from '@comfyorg/design-system/media/Video'
import DesktopDialogSurface from '../ui/DesktopDialogSurface.vue'
import AgentMark from './AgentMark.vue'
import AgentMarks from './AgentMarks.vue'
import { MODAL_TITLE_CLASS } from '../../lib/modalTitle'
import { useDeployToCloud } from '../../composables/useDeployToCloud'
import { useModal } from '../../composables/useModal'
import type { AgentApp, Installation } from '../../types/ipc'

const MEDIA_BASE = 'https://media.comfy.org/website/cloud-deploy'
const VIDEO_SOURCES = [
  { src: `${MEDIA_BASE}/cloud-deploy-1280.webm`, type: 'video/webm' },
  { src: `${MEDIA_BASE}/cloud-deploy-1280.mp4`, type: 'video/mp4' }
]
const VIDEO_POSTER_SRC = `${MEDIA_BASE}/cloud-deploy-poster.jpg`
const DOCS_URL = 'https://docs.comfy.org/development/overview'
const COPIED_FOR_MS = 2000

const { t, tm } = useI18n()
const modal = useModal()
const { target, close, setUpManually, openAgent, copyPrompt } = useDeployToCloud()

const points = computed<string[]>(() => {
  const raw = tm('devPlatform.deployToCloud.points')
  return Array.isArray(raw) ? (raw as unknown as string[]) : []
})

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

function clearCopied(): void {
  clearTimeout(copiedTimer)
  copied.value = false
}

let opening = 0

watch(target, () => {
  opening += 1
  clearCopied()
})

function stillShowing(inst: Installation, openedAt: number): boolean {
  return opening === openedAt && target.value === inst
}
onBeforeUnmount(clearCopied)

function openDocs(): void {
  void window.api.openExternal(DOCS_URL)
}

function pickSetUpManually(): void {
  const inst = target.value
  if (!inst) return
  close()
  void setUpManually(inst)
}

async function pickAgent(app: AgentApp): Promise<void> {
  const inst = target.value
  if (!inst) return
  const openedAt = opening
  const opened = await openAgent(app, inst)
  if (!stillShowing(inst, openedAt)) return
  if (opened) return close()
  await modal.alert({
    title: t('devPlatform.deployToCloud.agentFailedTitle'),
    message: t('devPlatform.deployToCloud.agentFailedMessage')
  })
}

async function pickCopyPrompt(): Promise<void> {
  const inst = target.value
  if (!inst) return
  const openedAt = opening
  const copiedPrompt = await copyPrompt(inst)
  if (!stillShowing(inst, openedAt)) return
  if (!copiedPrompt) {
    await modal.alert({
      title: t('devPlatform.deployToCloud.copyFailedTitle'),
      message: t('devPlatform.deployToCloud.copyFailedMessage')
    })
    return
  }
  clearCopied()
  copied.value = true
  copiedTimer = setTimeout(() => {
    copied.value = false
  }, COPIED_FOR_MS)
}
</script>

<template>
  <DesktopDialogSurface
    :open="target !== null"
    :aria-label="t('devPlatform.deployToCloud.title')"
    data-testid="deploy-to-cloud-dialog"
    overlay-class="deploy-to-cloud-overlay fixed inset-0 z-[1000] grid place-items-center bg-black/70 px-[clamp(16px,4vw,48px)] py-[clamp(32px,6vh,72px)]"
    content-class="deploy-to-cloud-panel relative flex w-[min(600px,100%)] max-h-full min-w-80 flex-col overflow-visible rounded-panel border border-solid border-border bg-neutral-800 px-5 pt-5 pb-4 text-neutral-100 shadow-[var(--modal-surface-shadow)]"
    @close="close"
  >
    <Button
      type="button"
      variant="muted-textonly"
      size="icon"
      class="deploy-to-cloud-close absolute top-0 -right-12 z-2 size-9 rounded-full modal-close-fill [--modal-close-card:var(--color-neutral-800)] text-white hover:text-white max-[860px]:top-3 max-[860px]:right-3"
      :aria-label="t('common.close')"
      data-testid="deploy-to-cloud-close"
      @click="close"
    >
      <X :size="18" />
    </Button>
    <div class="deploy-to-cloud-scroll min-h-0 flex-auto overflow-y-auto">
      <Video
        :sources="VIDEO_SOURCES"
        :poster-src="VIDEO_POSTER_SRC"
        autoplay
        muted
        loop
        plays-inline
        :playback-labels="{
          play: t('devPlatform.deployToCloud.play'),
          pause: t('devPlatform.deployToCloud.pause')
        }"
        class="deploy-to-cloud-video mb-5 aspect-video w-full rounded-lg bg-black object-cover"
        data-testid="deploy-to-cloud-video"
      >
        <template #fallback>
          <div class="mb-5 grid aspect-video w-full place-items-center rounded-lg bg-black">
            <span
              class="grid size-16 place-items-center rounded-full border border-solid border-white/30 bg-white/10"
              aria-hidden="true"
            >
              <Play :size="24" />
            </span>
          </div>
        </template>
      </Video>
      <h2 class="deploy-to-cloud-title m-0 mb-3" :class="MODAL_TITLE_CLASS">
        {{ t('devPlatform.deployToCloud.title') }}
      </h2>
      <div class="mb-6 flex flex-col gap-3 text-sm leading-[1.5] text-text-muted">
        <p class="m-0 text-pretty">{{ t('devPlatform.deployToCloud.body') }}</p>
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          <li v-for="point in points" :key="point" class="flex items-start gap-2.5 text-text/75">
            <Check :size="14" class="mt-[3px] shrink-0 text-text-muted" aria-hidden="true" />
            {{ point }}
          </li>
        </ul>
        <p
          class="mt-1 mb-0 flex items-start gap-1.5 text-sm leading-[1.45] text-text-muted/75"
          data-testid="deploy-to-cloud-note"
        >
          <Info :size="15" class="mt-[2px] shrink-0" aria-hidden="true" />
          <span class="min-w-0">{{ t('devPlatform.deployToCloud.note') }}</span>
        </p>
      </div>
    </div>
    <footer
      class="deploy-to-cloud-footer -mx-5 flex flex-wrap items-center justify-end gap-2 border-t border-solid border-neutral-100/8 px-5 pt-4"
    >
      <a
        :href="DOCS_URL"
        class="mr-auto inline-flex items-center gap-1.5 text-sm text-text-muted no-underline hover:text-text"
        data-testid="deploy-to-cloud-docs"
        @click.prevent="openDocs"
      >
        {{ t('devPlatform.deployToCloud.readDocs') }}
        <SquareArrowOutUpRight :size="14" aria-hidden="true" />
      </a>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        class="gap-1.5"
        data-testid="deploy-to-cloud-manual"
        @click="pickSetUpManually"
      >
        {{ t('devPlatform.deployToCloud.setUpManually') }}
        <SquareArrowOutUpRight :size="15" aria-hidden="true" />
      </Button>
      <Menu
        :modal="false"
        align="end"
        :side-offset="6"
        :collision-padding="4"
        class="z-[9999] min-w-52"
      >
        <template #trigger>
          <Button
            type="button"
            variant="inverted"
            size="lg"
            class="gap-2.5"
            data-initial-focus
            data-testid="deploy-to-cloud-agent"
          >
            <template v-if="copied">
              <Check :size="15" aria-hidden="true" />
              {{ t('devPlatform.deployToCloud.copied') }}
            </template>
            <template v-else>
              <AgentMarks />
              {{ t('devPlatform.deployToCloud.useAgent') }}
            </template>
            <ChevronDown :size="15" aria-hidden="true" />
          </Button>
        </template>
        <MenuItem data-testid="deploy-to-cloud-agent-claude" @select="pickAgent('claude')">
          <AgentMark agent="claude" />
          {{ t('devPlatform.deployToCloud.openInClaude') }}
        </MenuItem>
        <MenuItem data-testid="deploy-to-cloud-agent-codex" @select="pickAgent('codex')">
          <AgentMark agent="codex" />
          {{ t('devPlatform.deployToCloud.openInCodex') }}
        </MenuItem>
        <MenuItem data-testid="deploy-to-cloud-agent-copy" @select="pickCopyPrompt">
          <Copy :size="16" aria-hidden="true" />
          {{ t('devPlatform.deployToCloud.copyPrompt') }}
        </MenuItem>
      </Menu>
    </footer>
  </DesktopDialogSurface>
</template>
