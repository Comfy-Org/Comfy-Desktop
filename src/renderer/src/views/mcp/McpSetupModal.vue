<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, Check, Copy, SquareTerminal, Volume2, VolumeX, X } from 'lucide-vue-next'
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

function trackCopy(client: McpSnippetClient | null): void {
  if (!client) return
  emitTelemetryAction('comfy.desktop.mcp.snippet_copied', { client })
}

const steps = computed(() => [
  {
    key: 'install',
    number: 1,
    title: t('mcpSetup.inAgent.install'),
    command: snippets.value.install,
    client: 'install' as const,
    testId: 'mcp-copy-install'
  },
  {
    key: 'register',
    number: 2,
    title: t('mcpSetup.inAgent.register'),
    command: snippets.value.register,
    client: 'claude_code' as const,
    testId: 'mcp-copy-claude-code'
  },
  {
    key: 'restart',
    number: 3,
    title: t('mcpSetup.inAgent.restart'),
    command: '',
    client: null,
    testId: ''
  }
])

const copiedClient = ref<McpSnippetClient | null>(null)
async function copyText(client: McpSnippetClient, text: string): Promise<void> {
  trackCopy(client)
  try {
    await navigator.clipboard.writeText(text)
    copiedClient.value = client
    setTimeout(() => {
      if (copiedClient.value === client) copiedClient.value = null
    }, 1600)
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
    overlay-class="fixed inset-0 z-60 flex bg-black/62 px-[clamp(56px,10vw,220px)] py-[clamp(40px,8vh,120px)] max-[820px]:px-2 max-[820px]:pt-15 max-[820px]:pb-2"
    content-class="relative size-full"
    @close="dismiss"
  >
    <button
      type="button"
      class="absolute top-0 -right-12 z-2 inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 p-0 text-white transition-colors hover:bg-white/18 max-[820px]:top-3 max-[820px]:right-3"
      :aria-label="t('common.close')"
      data-testid="mcp-setup-close"
      @click="dismiss"
    >
      <X :size="18" />
    </button>
    <div
      class="grid size-full grid-cols-[minmax(0,1fr)_clamp(360px,36vw,440px)] overflow-hidden rounded-[20px] bg-content-background text-foreground shadow-[0_0_0_1px_oklch(1_0_0/0.1),0_30px_80px_-20px_rgb(0_0_0/0.7)] max-[820px]:grid-cols-1 max-[820px]:grid-rows-[minmax(0,1fr)_minmax(0,60vh)]"
    >
      <div class="relative min-h-0 overflow-hidden bg-black">
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
        <button
          type="button"
          class="absolute bottom-3 left-3 z-2 inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-[rgb(14_14_16/0.28)] p-0 text-white/92 backdrop-blur-[14px] backdrop-saturate-150 transition-colors hover:bg-[rgb(14_14_16/0.45)]"
          :aria-label="isMuted ? t('mcpSetup.unmute') : t('mcpSetup.mute')"
          :aria-pressed="!isMuted"
          @click="toggleSound"
        >
          <VolumeX v-if="isMuted" :size="15" />
          <Volume2 v-else :size="15" />
        </button>
      </div>

      <aside
        class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[color-mix(in_oklch,var(--color-foreground)_6%,var(--color-content-background))]"
      >
        <div
          class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-x-hidden overflow-y-auto overscroll-contain pb-3"
        >
          <header class="flex flex-col gap-1.5 px-6 pt-6 pb-2">
            <h2 class="m-0 text-[18px] leading-6 font-semibold text-balance">
              {{ t('mcpSetup.title') }}
            </h2>
            <p class="m-0 text-[13px] leading-5 text-pretty text-muted-foreground">
              {{ t('mcpSetup.lead') }}
            </p>
          </header>

          <div class="px-6 pt-2 pb-2">
            <SegmentedControl
              :model-value="path"
              :options="pathOptions"
              :label="t('mcpSetup.pathLabel')"
              data-testid="mcp-setup-path"
              @update:model-value="selectPath"
            />
          </div>

          <template v-if="path === 'have_agent'">
            <section class="flex flex-col gap-4 px-6 pt-3 pb-1" data-testid="mcp-option-agent">
              <h3
                class="m-0 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
              >
                {{ t('mcpSetup.inAgent.label') }}
              </h3>
              <ol class="m-0 flex list-none flex-col gap-5 p-0">
                <li v-for="step in steps" :key="step.key" class="flex min-w-0 flex-col gap-2">
                  <p class="m-0 flex items-baseline gap-2 text-[13px] leading-5 font-medium">
                    <span
                      class="w-3 shrink-0 text-muted-foreground tabular-nums"
                      aria-hidden="true"
                      >{{ step.number }}</span
                    >
                    {{ step.title }}
                  </p>
                  <div
                    v-if="step.command"
                    class="group flex items-start gap-2 rounded-[10px] bg-foreground/6 py-1.5 pr-1.5 pl-3"
                  >
                    <code
                      class="min-w-0 flex-1 py-0.5 font-mono text-xs leading-5 [overflow-wrap:anywhere]"
                      >{{ step.command }}</code
                    >
                    <BaseCopyButton
                      class="opacity-0 transition-opacity duration-150 ease-out group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                      :value="step.command"
                      :aria-label="t('mcpSetup.copyCommand')"
                      :data-testid="step.testId"
                      @click="trackCopy(step.client)"
                    />
                  </div>
                  <p
                    v-if="step.key === 'register'"
                    class="m-0 text-xs leading-[18px] text-muted-foreground"
                  >
                    {{ t('mcpSetup.inAgent.jsonHint') }}
                    <button
                      type="button"
                      class="cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-foreground hover:underline"
                      data-testid="mcp-copy-json"
                      @click="copyText('json', snippets.json)"
                    >
                      {{
                        copiedClient === 'json'
                          ? t('mcpSetup.copied')
                          : t('mcpSetup.inAgent.copyJson')
                      }}
                    </button>
                  </p>
                </li>
              </ol>
            </section>

            <section class="px-6 pt-2 pb-3" data-testid="mcp-option-terminal">
              <div class="flex flex-col gap-3 rounded-[12px] bg-foreground/5 p-4">
                <div class="flex flex-col gap-1">
                  <h3 class="m-0 text-[13px] leading-5 font-medium">
                    {{ t('mcpSetup.inTerminal.label') }}
                  </h3>
                  <p class="m-0 text-xs leading-[18px] text-pretty text-muted-foreground">
                    {{ t('mcpSetup.inTerminal.body') }}
                  </p>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    class="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-foreground/8 px-3 text-[13px] text-foreground transition-colors hover:bg-foreground/12"
                    :title="snippets.terminal"
                    data-testid="mcp-copy-terminal"
                    @click="copyText('terminal', snippets.terminal)"
                  >
                    <Check v-if="copiedClient === 'terminal'" :size="14" />
                    <Copy v-else :size="14" />
                    {{
                      copiedClient === 'terminal' ? t('mcpSetup.copied') : t('mcpSetup.copyCommand')
                    }}
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-foreground/8 px-3 text-[13px] text-foreground transition-colors hover:bg-foreground/12"
                    data-testid="mcp-open-terminal"
                    @click="openTerminal"
                  >
                    <SquareTerminal :size="14" />
                    {{ t('mcpSetup.inTerminal.open') }}
                  </button>
                </div>
              </div>
            </section>
          </template>

          <section v-else class="flex flex-col gap-3 px-6 py-3" data-testid="mcp-agents">
            <h3
              class="m-0 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
            >
              {{ t('mcpSetup.agents.label') }}
            </h3>
            <p class="m-0 text-[13px] leading-5 text-pretty">
              {{ t('mcpSetup.agents.body') }}
            </p>
            <ul class="m-0 flex list-none flex-col gap-1 p-0">
              <li v-for="agent in MCP_AGENTS" :key="agent.id">
                <button
                  type="button"
                  class="flex h-10 w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-foreground/5 px-3 text-left text-[13px] text-foreground transition-colors hover:bg-foreground/9"
                  :data-testid="`mcp-agent-${agent.id}`"
                  @click="openLink(agent.id, agent.url)"
                >
                  <svg class="size-4 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                    <path :d="agent.icon" />
                  </svg>
                  <span class="font-medium">{{ agent.name }}</span>
                  <span class="text-xs text-muted-foreground">{{
                    t('mcpSetup.agents.installGuide')
                  }}</span>
                  <ArrowUpRight :size="14" class="ml-auto text-muted-foreground" />
                </button>
              </li>
            </ul>
          </section>
        </div>

        <footer class="border-t border-solid border-neutral-100/8 p-4">
          <button
            type="button"
            class="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-0 bg-foreground/7 px-3 text-[13px] text-foreground transition-colors hover:bg-foreground/11"
            data-testid="mcp-docs"
            @click="openLink('mcp_docs', MCP_DOCS_URL)"
          >
            {{ t('mcpSetup.docs') }}
            <ArrowUpRight :size="14" />
          </button>
        </footer>
      </aside>
    </div>
  </DesktopDialogSurface>
</template>
