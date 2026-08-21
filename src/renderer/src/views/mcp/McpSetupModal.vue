<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { emitTelemetryAction } from '../../lib/telemetry'
import McpVideoPlayer from './McpVideoPlayer.vue'

const emit = defineEmits<{
  close: []
  openTerminal: []
}>()

type Path = 'have_agent' | 'no_agent'
const path = ref<Path>('have_agent')

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') dismiss()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const CONNECT_STEPS = [
  { client: 'install', label: 'Install the server', value: 'pip install comfy-mcp' },
  { client: 'claude_code', label: 'Add to Claude Code', value: 'claude mcp add comfy-mcp -- comfy-mcp' },
  {
    client: 'json',
    label: 'Cursor / Claude Desktop (JSON)',
    value: '{ "mcpServers": { "comfy-mcp": { "command": "comfy-mcp" } } }'
  }
]

const AGENTS = [
  { label: 'Claude Code', href: 'https://docs.anthropic.com/en/docs/claude-code/setup' },
  { label: 'Cursor', href: 'https://docs.cursor.com/get-started/installation' },
  { label: 'Codex', href: 'https://developers.openai.com/codex/cli' }
]

const DOCS_URL = 'https://docs.comfy.org/agent-tools/mcp#local-comfy-mcp-connection'
const VIDEO_SRC = 'https://media.comfy.org/website/mcp/launch-film.mp4'

const copiedClient = ref<string | null>(null)

function selectPath(next: Path): void {
  if (path.value === next) return
  path.value = next
  emitTelemetryAction('comfy.desktop.mcp.path_selected', { path: next })
}

async function copy(step: (typeof CONNECT_STEPS)[number]): Promise<void> {
  try {
    await navigator.clipboard.writeText(step.value)
  } catch {
    /* clipboard blocked — no-op */
  }
  copiedClient.value = step.client
  emitTelemetryAction('comfy.desktop.mcp.snippet_copied', { client: step.client })
  window.setTimeout(() => {
    if (copiedClient.value === step.client) copiedClient.value = null
  }, 1600)
}

function openTerminal(): void {
  emitTelemetryAction('comfy.desktop.mcp.path_selected', { path: 'have_agent' })
  emit('openTerminal')
  emit('close')
}

function openDocs(target: string): void {
  emitTelemetryAction('comfy.desktop.mcp.docs_opened', { target })
  if (target === 'agent_install') return
  window.api?.openPath?.(DOCS_URL)
}

function dismiss(): void {
  emitTelemetryAction('comfy.desktop.mcp.panel_dismissed', { stage: 'panel' })
  emit('close')
}
</script>

<template>
  <div class="mcp-backdrop" @click.self="dismiss">
    <div class="mcp-modal" role="dialog" aria-modal="true" aria-label="Connect an agent with Comfy MCP">
      <section class="mcp-media">
        <McpVideoPlayer :src="VIDEO_SRC" aria-label="How to connect an agent with Comfy MCP" />
      </section>

      <section class="mcp-panel">
        <button class="mcp-close" aria-label="Close" @click="dismiss">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <header class="mcp-head">
          <h2 class="mcp-title">Connect an agent with Comfy MCP</h2>
          <p class="mcp-lead">
            Point your own AI agent at this ComfyUI over MCP — right inside the desktop terminal.
          </p>
        </header>

        <div class="mcp-seg" role="tablist" aria-label="Setup path">
          <button
            role="tab"
            :aria-selected="path === 'have_agent'"
            class="mcp-seg__btn"
            :class="{ 'is-active': path === 'have_agent' }"
            @click="selectPath('have_agent')"
          >
            I have an agent
          </button>
          <button
            role="tab"
            :aria-selected="path === 'no_agent'"
            class="mcp-seg__btn"
            :class="{ 'is-active': path === 'no_agent' }"
            @click="selectPath('no_agent')"
          >
            I need one
          </button>
        </div>

        <div class="mcp-body">
          <div v-if="path === 'have_agent'" class="mcp-steps">
            <div v-for="step in CONNECT_STEPS" :key="step.client" class="mcp-step">
              <span class="mcp-step__label">{{ step.label }}</span>
              <div class="mcp-cmd">
                <code class="mcp-cmd__text">{{ step.value }}</code>
                <button
                  class="mcp-cmd__copy"
                  :aria-label="copiedClient === step.client ? 'Copied' : 'Copy'"
                  @click="copy(step)"
                >
                  <svg v-if="copiedClient === step.client" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div v-else class="mcp-agents">
            <p class="mcp-agents__hint">
              Comfy MCP works with any agent that speaks MCP. Install one, then switch back to connect.
            </p>
            <div class="mcp-agents__list">
              <a
                v-for="agent in AGENTS"
                :key="agent.label"
                class="mcp-agent"
                :href="agent.href"
                target="_blank"
                rel="noreferrer"
                @click="openDocs('agent_install')"
              >
                <span class="mcp-agent__name">{{ agent.label }}</span>
                <span class="mcp-agent__meta">Install guide</span>
                <svg class="mcp-ext mcp-agent__ext" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 17L17 7M9 7h8v8" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        <footer class="mcp-actions">
          <button class="mcp-btn mcp-btn--primary" @click="openTerminal">Open terminal</button>
          <button class="mcp-btn mcp-btn--ghost" @click="openDocs('mcp_local')">
            Read the docs
            <svg class="mcp-ext" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mcp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: rgba(6, 5, 8, 0.62);
  backdrop-filter: blur(4px);
  animation: mcp-fade 160ms ease;
}
@keyframes mcp-fade {
  from {
    opacity: 0;
  }
}

.mcp-modal {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  width: min(100%, 1040px);
  max-height: min(660px, calc(100vh - 64px));
  overflow: hidden;
  border-radius: 16px;
  background: var(--neutral-800);
  border: 1px solid color-mix(in oklab, var(--neutral-100) 9%, transparent);
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
  color: var(--text);
  font-family: var(--font-sans);
  animation: mcp-rise 220ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes mcp-rise {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }
}

/* ---- Media (bleeds edge-to-edge) ---- */
.mcp-media {
  position: relative;
  min-height: 100%;
  background: #000;
}

/* ---- Content panel ---- */
.mcp-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-width: 0;
  padding: 36px;
  overflow: auto;
}
.mcp-close {
  position: absolute;
  top: 18px;
  right: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  background: transparent;
  color: color-mix(in oklab, var(--neutral-100) 55%, transparent);
  transition: background 140ms ease, color 140ms ease;
}
.mcp-close:hover {
  background: color-mix(in oklab, var(--neutral-100) 8%, transparent);
  color: var(--text);
}
.mcp-close svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.mcp-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 32px;
}
.mcp-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1.18;
  font-weight: 500;
  letter-spacing: -0.01em;
}
.mcp-lead {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: color-mix(in oklab, var(--neutral-100) 62%, transparent);
}

/* ---- Neutral segmented control (accent reserved for the CTA) ---- */
.mcp-seg {
  display: inline-flex;
  align-self: flex-start;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: color-mix(in oklab, var(--neutral-100) 5%, transparent);
  border: 1px solid color-mix(in oklab, var(--neutral-100) 7%, transparent);
}
.mcp-seg__btn {
  border: 0;
  cursor: pointer;
  padding: 7px 16px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  background: transparent;
  color: color-mix(in oklab, var(--neutral-100) 52%, transparent);
  transition: background 140ms ease, color 140ms ease;
}
.mcp-seg__btn:hover {
  color: color-mix(in oklab, var(--neutral-100) 82%, transparent);
}
.mcp-seg__btn.is-active {
  background: color-mix(in oklab, var(--neutral-100) 12%, transparent);
  color: var(--text);
}

/* ---- Body: fixed min-height so tab swaps don't reflow the modal ---- */
.mcp-body {
  min-height: 208px;
}

.mcp-steps {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.mcp-step {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mcp-step__label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: color-mix(in oklab, var(--neutral-100) 55%, transparent);
}
.mcp-cmd {
  display: flex;
  align-items: stretch;
  gap: 8px;
}
.mcp-cmd__text {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  align-content: center;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.5;
  padding: 11px 14px;
  border-radius: 8px;
  background: var(--brand-surface-bg);
  border: 1px solid var(--brand-surface-border);
  color: color-mix(in oklab, var(--neutral-100) 90%, transparent);
  scrollbar-width: none;
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
}
.mcp-cmd__text::-webkit-scrollbar {
  display: none;
}
.mcp-cmd__copy {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  border: 1px solid var(--brand-surface-border);
  border-radius: 8px;
  cursor: pointer;
  background: var(--brand-surface-bg);
  color: color-mix(in oklab, var(--neutral-100) 70%, transparent);
  transition: background 140ms ease, color 140ms ease;
}
.mcp-cmd__copy:hover {
  background: var(--brand-surface-bg-hover);
  color: var(--text);
}
.mcp-cmd__copy svg {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.mcp-agents {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.mcp-agents__hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: color-mix(in oklab, var(--neutral-100) 62%, transparent);
}
.mcp-agents__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mcp-agent {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 16px;
  border-radius: 8px;
  text-decoration: none;
  color: var(--text);
  background: var(--brand-surface-bg);
  border: 1px solid var(--brand-surface-border);
  transition: background 140ms ease;
}
.mcp-agent:hover {
  background: var(--brand-surface-bg-hover);
}
.mcp-agent__name {
  font-size: 13.5px;
  font-weight: 600;
}
.mcp-agent__meta {
  font-size: 12px;
  color: color-mix(in oklab, var(--neutral-100) 48%, transparent);
}
.mcp-agent__ext {
  margin-left: auto;
}

.mcp-actions {
  display: flex;
  gap: 10px;
  margin-top: auto;
  padding-top: 4px;
}
.mcp-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  cursor: pointer;
  height: 40px;
  padding: 0 22px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 600;
}
.mcp-btn--primary {
  background: var(--comfy-yellow);
  color: #211927;
  transition: filter 140ms ease;
}
.mcp-btn--primary:hover {
  filter: brightness(1.05);
}
.mcp-btn--ghost {
  background: transparent;
  color: color-mix(in oklab, var(--neutral-100) 78%, transparent);
  transition: background 140ms ease, color 140ms ease;
}
.mcp-btn--ghost:hover {
  background: color-mix(in oklab, var(--neutral-100) 8%, transparent);
  color: var(--text);
}

.mcp-ext {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.7;
}

@media (max-width: 800px) {
  .mcp-modal {
    grid-template-columns: 1fr;
    max-height: calc(100vh - 64px);
  }
  .mcp-media {
    aspect-ratio: 16 / 9;
    min-height: 0;
  }
}
</style>
