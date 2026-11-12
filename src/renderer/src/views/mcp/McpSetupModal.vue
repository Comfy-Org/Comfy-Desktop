<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { ArrowUpRight, SquareTerminal, Volume2, VolumeX, X } from 'lucide-vue-next'
import DesktopDialogSurface from '../../components/ui/DesktopDialogSurface.vue'
import SegmentedControl from '../../components/ui/SegmentedControl.vue'
import BaseCopyButton from '../../components/ui/BaseCopyButton.vue'
import { emitTelemetryAction } from '../../lib/telemetry'
import { buildMcpSnippets, MCP_AGENTS, MCP_DOCS_URL, MCP_VIDEO_URL } from './mcpSetup'
import type { McpSnippetClient } from './mcpSetup'

const { port = undefined } = defineProps<{ port?: number }>()

const emit = defineEmits<{ close: []; openTerminal: [] }>()

const { t } = useI18n()

type Path = 'have_agent' | 'no_agent'
const path = ref<Path>('have_agent')
const pathOptions = computed(() => [
  { value: 'have_agent' as const, label: t('mcpSetup.haveAgent') },
  { value: 'no_agent' as const, label: t('mcpSetup.needAgent') }
])

const snippets = computed(() => buildMcpSnippets(port))

function selectPath(next: Path): void {
  path.value = next
  emitTelemetryAction('comfy.desktop.mcp.path_selected', { path: next })
}

function trackCopy(client: McpSnippetClient): void {
  emitTelemetryAction('comfy.desktop.mcp.snippet_copied', { client })
}

const jsonCopied = ref(false)
async function copyJson(): Promise<void> {
  trackCopy('json')
  try {
    await navigator.clipboard.writeText(snippets.value.json)
    jsonCopied.value = true
    setTimeout(() => (jsonCopied.value = false), 1600)
  } catch {}
}

function openLink(target: string, url: string): void {
  emitTelemetryAction('comfy.desktop.mcp.docs_opened', { target })
  void window.api?.openExternal?.(url)
}

function openTerminal(): void {
  emitTelemetryAction('comfy.desktop.mcp.terminal_opened', {})
  emit('openTerminal')
  emit('close')
}

function dismiss(): void {
  emitTelemetryAction('comfy.desktop.mcp.panel_dismissed', {})
  emit('close')
}

const videoRef = ref<HTMLVideoElement | null>(null)
const isMuted = ref(true)
function toggleSound(): void {
  const video = videoRef.value
  if (!video) return
  video.muted = !video.muted
  isMuted.value = video.muted
  if (!video.muted) void video.play().catch(() => {})
}
</script>

<template>
  <DesktopDialogSurface
    :open="true"
    :aria-label="t('mcpSetup.title')"
    overlay-class="mcp-overlay fixed inset-0 z-60 grid place-items-center p-[clamp(24px,4vw,64px)] bg-neutral-800/70"
    content-class="mcp-content relative flex h-[min(680px,100%)] w-[min(100%,1040px)] overflow-hidden rounded-panel border border-solid border-border bg-neutral-900"
    @close="dismiss"
  >
    <Button
      variant="muted-textonly"
      size="icon"
      class="absolute top-4 right-4 z-2"
      type="button"
      :aria-label="t('common.close')"
      data-testid="mcp-setup-close"
      @click="dismiss"
    >
      <X :size="18" />
    </Button>
    <div
      class="grid size-full grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] max-[800px]:grid-cols-1 max-[800px]:overflow-y-auto"
    >
      <div class="relative min-h-full bg-neutral-950 max-[800px]:aspect-video max-[800px]:min-h-0">
        <video
          ref="videoRef"
          class="absolute inset-0 block size-full object-cover"
          :src="MCP_VIDEO_URL"
          autoplay
          muted
          loop
          playsinline
          :aria-label="t('mcpSetup.videoAlt')"
        />
        <Button
          variant="secondary"
          size="icon"
          class="absolute bottom-4 left-4 z-2"
          type="button"
          :aria-label="isMuted ? t('mcpSetup.unmute') : t('mcpSetup.mute')"
          :aria-pressed="!isMuted"
          @click="toggleSound"
        >
          <VolumeX v-if="isMuted" :size="16" />
          <Volume2 v-else :size="16" />
        </Button>
      </div>

      <div class="flex min-h-0 min-w-0 flex-col gap-5 p-[clamp(1.5rem,2.5vw,2.25rem)]">
        <header class="flex flex-col gap-2 pr-10">
          <h2 class="m-0 font-display text-2xl leading-8 font-extrabold text-neutral-100">
            {{ t('mcpSetup.title') }}
          </h2>
          <p class="m-0 text-sm leading-normal text-neutral-300">{{ t('mcpSetup.lead') }}</p>
        </header>

        <SegmentedControl
          :model-value="path"
          :options="pathOptions"
          :label="t('mcpSetup.pathLabel')"
          class="self-start"
          data-testid="mcp-setup-path"
          @update:model-value="selectPath"
        />

        <div class="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          <div v-if="path === 'have_agent'" class="flex flex-col gap-5">
            <section class="flex flex-col gap-2" data-testid="mcp-option-agent">
              <h3 class="m-0 text-[11px] font-semibold tracking-[0.04em] text-text-muted uppercase">
                {{ t('mcpSetup.inAgent.label') }}
              </h3>
              <div class="flex flex-col gap-3 rounded-lg border border-solid border-border p-3">
                <p class="m-0 text-[13px] leading-normal text-neutral-300">
                  {{ t('mcpSetup.inAgent.body') }}
                </p>
                <div
                  class="flex items-start gap-2 rounded-md bg-secondary py-1.5 pr-1.5 pl-3 font-mono text-xs"
                >
                  <code
                    class="min-w-0 flex-1 leading-5 [overflow-wrap:anywhere]"
                    :title="snippets.claudeCode"
                    >{{ snippets.claudeCode }}</code
                  >
                  <BaseCopyButton
                    :value="snippets.claudeCode"
                    :aria-label="t('mcpSetup.copyCommand')"
                    data-testid="mcp-copy-claude-code"
                    @click="trackCopy('claude_code')"
                  />
                </div>
                <p class="m-0 text-xs text-text-muted">
                  {{ t('mcpSetup.inAgent.jsonHint') }}
                  <Button
                    variant="link"
                    size="link"
                    class="py-0 text-xs font-semibold text-foreground"
                    type="button"
                    data-testid="mcp-copy-json"
                    @click="copyJson"
                  >
                    {{ jsonCopied ? t('mcpSetup.copied') : t('mcpSetup.inAgent.copyJson') }}
                  </Button>
                </p>
              </div>
            </section>

            <section class="flex flex-col gap-2" data-testid="mcp-option-terminal">
              <h3 class="m-0 text-[11px] font-semibold tracking-[0.04em] text-text-muted uppercase">
                {{ t('mcpSetup.inTerminal.label') }}
              </h3>
              <div class="flex flex-col gap-3 rounded-lg border border-solid border-border p-3">
                <p class="m-0 text-[13px] leading-normal text-neutral-300">
                  {{ t('mcpSetup.inTerminal.body') }}
                </p>
                <div
                  class="flex items-start gap-2 rounded-md bg-secondary py-1.5 pr-1.5 pl-3 font-mono text-xs"
                >
                  <code
                    class="min-w-0 flex-1 leading-5 [overflow-wrap:anywhere]"
                    :title="snippets.terminal"
                    >{{ snippets.terminal }}</code
                  >
                  <BaseCopyButton
                    :value="snippets.terminal"
                    :aria-label="t('mcpSetup.copyCommand')"
                    data-testid="mcp-copy-terminal"
                    @click="trackCopy('terminal')"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="md"
                  class="self-start"
                  type="button"
                  data-testid="mcp-open-terminal"
                  @click="openTerminal"
                >
                  <SquareTerminal :size="14" />
                  {{ t('mcpSetup.inTerminal.open') }}
                </Button>
              </div>
            </section>
          </div>

          <section v-else class="flex flex-col gap-2" data-testid="mcp-agents">
            <h3 class="m-0 text-[11px] font-semibold tracking-[0.04em] text-text-muted uppercase">
              {{ t('mcpSetup.agents.label') }}
            </h3>
            <p class="m-0 text-[13px] leading-normal text-neutral-300">
              {{ t('mcpSetup.agents.body') }}
            </p>
            <ul class="m-0 flex list-none flex-col gap-2 p-0">
              <li v-for="agent in MCP_AGENTS" :key="agent.id">
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-solid border-border bg-transparent px-3 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
                  :data-testid="`mcp-agent-${agent.id}`"
                  @click="openLink(agent.id, agent.url)"
                >
                  <svg class="size-4 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                    <path :d="agent.icon" />
                  </svg>
                  <span class="font-semibold">{{ agent.name }}</span>
                  <span class="text-xs text-text-muted">{{
                    t('mcpSetup.agents.installGuide')
                  }}</span>
                  <ArrowUpRight :size="14" class="ml-auto text-text-muted" />
                </button>
              </li>
            </ul>
          </section>
        </div>

        <footer class="flex border-t border-solid border-neutral-100/8 pt-4">
          <Button
            variant="secondary"
            size="md"
            type="button"
            data-testid="mcp-docs"
            @click="openLink('mcp_docs', MCP_DOCS_URL)"
          >
            {{ t('mcpSetup.docs') }}
            <ArrowUpRight :size="14" />
          </Button>
        </footer>
      </div>
    </div>
  </DesktopDialogSurface>
</template>
