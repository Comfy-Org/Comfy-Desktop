<script setup lang="ts">
import { ref } from 'vue'
import { emitTelemetryAction } from '../../lib/telemetry'
import BaseModal from '../../components/ui/BaseModal.vue'
import McpVideoPlayer from './McpVideoPlayer.vue'

const emit = defineEmits<{
  close: []
  openTerminal: []
}>()

type Path = 'have_agent' | 'no_agent'
const path = ref<Path>('have_agent')

/** Within "I have an agent": where the agent runs. Both options start
 *  collapsed; each toggles independently. */
type AgentMode = 'in_agent' | 'in_terminal'
const openOption = ref<AgentMode | null>('in_agent')

function toggleOption(next: AgentMode): void {
  if (openOption.value === next) {
    openOption.value = null
    return
  }
  openOption.value = next
  emitTelemetryAction('comfy.desktop.mcp.option_selected', { option: next })
}

interface CopyStep {
  client: string
  label: string
  value: string
}

// Option 1 — bring Comfy into the agent the user already drives elsewhere.
// One snippet, one copy. Cursor / Claude Desktop users copy the JSON via the
// inline link instead of a third stacked field.
const AGENT_STEP: CopyStep = {
  client: 'claude_code',
  label: 'Copy into your agent',
  value: 'pip install comfy-mcp && claude mcp add comfy-mcp -- comfy-mcp'
}
const JSON_STEP = {
  client: 'json',
  label: 'Cursor / Claude Desktop (JSON)',
  value: '{ "mcpServers": { "comfy-mcp": { "command": "comfy-mcp" } } }'
}

// Option 2 — run the agent inside the desktop terminal instead: one line that
// installs, registers and launches, since the terminal already lives next to
// this ComfyUI.
const TERMINAL_STEP = {
  client: 'terminal_one_liner',
  label: 'Run in the Comfy terminal',
  value: 'pip install comfy-mcp && claude mcp add comfy-mcp -- comfy-mcp && claude'
}

// `icon` is the official simple-icons monochrome path (24x24 viewBox),
// rendered solid white in the row.
const AGENTS = [
  {
    label: 'Claude Code',
    href: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    icon: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
  },
  {
    label: 'Cursor',
    href: 'https://docs.cursor.com/get-started/installation',
    icon: 'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23'
  },
  {
    label: 'Codex',
    href: 'https://developers.openai.com/codex/cli',
    icon: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'
  }
]

const DOCS_URL = 'https://docs.comfy.org/agent-tools/mcp#local-comfy-mcp-connection'
const VIDEO_SRC = 'https://media.comfy.org/website/mcp/launch-film.mp4'

const copiedClient = ref<string | null>(null)

function selectPath(next: Path): void {
  if (path.value === next) return
  path.value = next
  emitTelemetryAction('comfy.desktop.mcp.path_selected', { path: next })
}

async function copy(step: CopyStep): Promise<void> {
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
  emitTelemetryAction('comfy.desktop.mcp.terminal_opened', {})
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
  <BaseModal
    :open="true"
    size="xl"
    aria-label="Connect an agent with Comfy MCP"
    :show-close-button="false"
    blur-overlay
    content-class="mcp-modal-panel"
    @close="dismiss"
  >
    <div class="mcp-modal">
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
          <h2 class="mcp-title">Connect an agent via MCP</h2>
          <p class="mcp-lead">
            Point your own AI agent at this ComfyUI over MCP, right inside the desktop terminal.
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
          <div v-if="path === 'have_agent'" class="mcp-options">
            <section class="mcp-option" :class="{ 'is-open': openOption === 'in_agent' }">
              <button
                type="button"
                class="mcp-option__head"
                :aria-expanded="openOption === 'in_agent'"
                @click="toggleOption('in_agent')"
              >
                <span class="mcp-option__text">
                  <span class="mcp-option__title">
                    <svg class="mcp-option__glyph" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 17L17 7M9 7h8v8" />
                    </svg>
                    Use Comfy in your agent
                  </span>
                  <span class="mcp-option__sub"
                    >Copy the setup into the agent you already use.</span
                  >
                </span>
                <svg class="mcp-option__chevron" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <div v-show="openOption === 'in_agent'" class="mcp-steps">
                <div class="mcp-cmd">
                  <code class="mcp-cmd__text">{{ AGENT_STEP.value }}</code>
                  <button
                    class="mcp-cmd__copy"
                    :aria-label="copiedClient === AGENT_STEP.client ? 'Copied' : 'Copy'"
                    @click="copy(AGENT_STEP)"
                  >
                    <svg
                      v-if="copiedClient === AGENT_STEP.client"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="9" y="9" width="11" height="11" rx="2" />
                      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                    </svg>
                  </button>
                </div>
                <p class="mcp-alt">
                  Using Cursor or Claude Desktop?
                  <button class="mcp-alt__link" @click="copy(JSON_STEP)">
                    {{ copiedClient === JSON_STEP.client ? 'Copied' : 'Copy the JSON config' }}
                  </button>
                </p>
              </div>
            </section>

            <section class="mcp-option" :class="{ 'is-open': openOption === 'in_terminal' }">
              <button
                type="button"
                class="mcp-option__head"
                :aria-expanded="openOption === 'in_terminal'"
                @click="toggleOption('in_terminal')"
              >
                <span class="mcp-option__text">
                  <span class="mcp-option__title">
                    <svg class="mcp-option__glyph" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 17l6-5-6-5M12 19h8" />
                    </svg>
                    Use your agent inside the Comfy terminal
                  </span>
                  <span class="mcp-option__sub"
                    >Open the terminal below and run the setup there.</span
                  >
                </span>
                <svg class="mcp-option__chevron" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <div v-show="openOption === 'in_terminal'" class="mcp-cmd">
                <code class="mcp-cmd__text">{{ TERMINAL_STEP.value }}</code>
                <button
                  class="mcp-cmd__copy"
                  :aria-label="copiedClient === TERMINAL_STEP.client ? 'Copied' : 'Copy'"
                  @click="copy(TERMINAL_STEP)"
                >
                  <svg
                    v-if="copiedClient === TERMINAL_STEP.client"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                </button>
              </div>
              <button
                v-show="openOption === 'in_terminal'"
                class="mcp-btn mcp-btn--outline mcp-option__cta"
                @click="openTerminal"
              >
                Open terminal
              </button>
            </section>
          </div>

          <div v-else class="mcp-agents">
            <p class="mcp-agents__hint">
              Comfy MCP works with any agent that speaks MCP. Install one, then switch back to
              connect.
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
                <svg class="mcp-agent__logo" viewBox="0 0 24 24" aria-hidden="true">
                  <path :d="agent.icon" />
                </svg>
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
          <button class="mcp-btn mcp-btn--soft" @click="openDocs('mcp_local')">
            Read the docs
            <svg class="mcp-ext" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </button>
        </footer>
      </section>
    </div>
  </BaseModal>
</template>

<style scoped>
/* BaseModal owns the overlay, focus trap, scroll lock, ESC and fade. This
   contentClass strips its default padded panel so the two-column layout can
   bleed edge-to-edge. */
:deep(.mcp-modal-panel) {
  width: min(100%, 1040px);
  max-width: min(100%, 1040px);
  max-height: min(720px, calc(100vh - 64px));
  padding: 0;
  overflow: hidden;
  border: 1px solid color-mix(in oklab, var(--neutral-100) 9%, transparent);
}

.mcp-modal {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  width: 100%;
  max-height: min(720px, calc(100vh - 64px));
  overflow: hidden;
  border-radius: 16px;
  background: var(--neutral-800);
  color: var(--text);
  font-family: var(--font-sans);
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
  gap: 16px;
  min-width: 0;
  padding: 40px 36px 30px;
  overflow: auto;
}
.mcp-close {
  position: absolute;
  top: 18px;
  right: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid color-mix(in oklab, var(--neutral-100) 14%, transparent);
  border-radius: 999px;
  cursor: pointer;
  background: color-mix(in oklab, var(--neutral-100) 6%, transparent);
  color: color-mix(in oklab, var(--neutral-100) 80%, transparent);
  transition:
    background 140ms ease,
    color 140ms ease;
}
.mcp-close:hover {
  background: color-mix(in oklab, var(--neutral-100) 8%, transparent);
  color: var(--text);
}
.mcp-close svg {
  flex: none;
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
  font-size: 24px;
  line-height: 1.18;
  font-weight: 600;
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
  transition:
    background 140ms ease,
    color 140ms ease;
}
.mcp-seg__btn:hover {
  color: color-mix(in oklab, var(--neutral-100) 82%, transparent);
}
.mcp-seg__btn.is-active {
  background: color-mix(in oklab, var(--neutral-100) 12%, transparent);
  color: var(--text);
}

/* ---- Body: fixed min-height so tab swaps don't reflow the modal ---- */
/* Fixed to the tallest state (terminal option expanded) so switching tabs or
 * toggling options never resizes the modal. */
.mcp-body {
  min-height: 262px;
}

/* ---- The two "I have an agent" options (Jo's structure) ---- */
.mcp-options {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.mcp-option {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--neutral-100) 8%, transparent);
  background: transparent;
  transition:
    background 140ms ease,
    border-color 140ms ease;
}
.mcp-option.is-open {
  background: color-mix(in oklab, var(--neutral-100) 3.5%, transparent);
  border-color: color-mix(in oklab, var(--neutral-100) 12%, transparent);
}
.mcp-option__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.mcp-option:not(.is-open):hover {
  border-color: color-mix(in oklab, var(--neutral-100) 16%, transparent);
}
.mcp-option__chevron {
  flex: none;
  width: 15px;
  height: 15px;
  margin-top: 8px;
  margin-left: auto;
  fill: none;
  stroke: color-mix(in oklab, var(--neutral-100) 45%, transparent);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 160ms ease;
}
.mcp-option.is-open .mcp-option__chevron {
  transform: rotate(180deg);
}
.mcp-option__glyph {
  flex: none;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--text);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mcp-option__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.mcp-option__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
}
.mcp-option__sub {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: color-mix(in oklab, var(--neutral-100) 55%, transparent);
}
.mcp-option__cta {
  align-self: flex-start;
}
.mcp-steps {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 2px;
}
.mcp-alt {
  margin: 0;
  font-size: 12px;
  color: color-mix(in oklab, var(--neutral-100) 48%, transparent);
}
.mcp-alt__link {
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  color: color-mix(in oklab, var(--neutral-100) 78%, transparent);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: color-mix(in oklab, var(--neutral-100) 30%, transparent);
}
.mcp-alt__link:hover {
  color: var(--text);
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
  padding: 9px 14px;
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
  transition:
    background 140ms ease,
    color 140ms ease;
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
.mcp-agent__logo {
  flex: none;
  width: 16px;
  height: 16px;
  fill: var(--text);
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
.mcp-btn--outline {
  height: 34px;
  padding: 0 16px;
  font-size: 12.5px;
  background: transparent;
  color: var(--text);
  border: 1px solid color-mix(in oklab, var(--neutral-100) 28%, transparent);
  transition:
    background 140ms ease,
    border-color 140ms ease;
}
.mcp-btn--soft {
  height: 34px;
  padding: 0 16px;
  font-size: 12.5px;
  background: color-mix(in oklab, var(--neutral-100) 8%, transparent);
  color: var(--text);
  border: 0;
  transition: background 140ms ease;
}
.mcp-btn--soft:hover {
  background: color-mix(in oklab, var(--neutral-100) 13%, transparent);
}
.mcp-btn--outline:hover {
  background: color-mix(in oklab, var(--neutral-100) 7%, transparent);
  border-color: color-mix(in oklab, var(--neutral-100) 42%, transparent);
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
