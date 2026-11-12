<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpRight, Check, Copy, SquareTerminal, Volume2, VolumeX, X } from 'lucide-vue-next'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { PORTAL_TO } from '../../ui/portal'
import { toast } from '../../useProto'
import MarSeg from '../pages/MarSeg.vue'
import { buildMcpSnippets, mcp, MCP_AGENTS, MCP_VIDEO_URL } from './mcpSetup'
import type { McpSnippetClient } from './mcpSetup'
import '../assets/AssetDetail.vue'
import './mcp.css'

/**
 * Connect a local agent (Comfy-Desktop#2032), in the format of the asset
 * and template views: the film on the left, the details panel on the
 * right, the close just outside the corner. Two paths: I have an agent
 * (three steps, or the Comfy terminal) and I need one (install guides).
 */
const open = computed({
  get: () => !!mcp.open,
  set: (v: boolean) => {
    if (!v) mcp.open = null
  }
})

type Path = 'have_agent' | 'no_agent'
const path = ref<Path>('have_agent')
const PATHS = [
  { value: 'have_agent' as const, label: 'I have an agent' },
  { value: 'no_agent' as const, label: 'I need one' }
]

const snippets = computed(() => buildMcpSnippets(mcp.open?.port))
const steps = computed(() => [
  {
    key: 'install',
    title: 'Install Comfy MCP in your own terminal',
    command: snippets.value.install
  },
  { key: 'register', title: 'Add it to Claude Code', command: snippets.value.register },
  { key: 'restart', title: 'Restart your agent', command: '' }
])

const copied = ref<McpSnippetClient | `step-${string}` | null>(null)
function copy(what: McpSnippetClient | `step-${string}`, text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {})
  copied.value = what
  setTimeout(() => {
    if (copied.value === what) copied.value = null
  }, 1600)
}

function openTerminal(): void {
  toast(`Opened the terminal on ${mcp.open?.name ?? 'this build'}`)
  mcp.open = null
}

const film = ref<HTMLVideoElement | null>(null)
const muted = ref(true)
function toggleSound(): void {
  const v = film.value
  if (!v) return
  v.muted = !v.muted
  muted.value = v.muted
  if (!v.muted) void v.play().catch(() => {})
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="PORTAL_TO" defer>
      <DialogOverlay class="proto-ui mad-scrim" />
      <DialogContent class="proto-ui mad mcp" aria-describedby="mcp-lead">
        <section class="mad-stage mcp-stage">
          <video
            ref="film"
            class="mcp-film"
            :src="MCP_VIDEO_URL"
            autoplay
            muted
            loop
            playsinline
            aria-label="How to connect an agent to Comfy over MCP"
          />
          <button
            type="button"
            class="mcp-sound"
            :aria-label="muted ? 'Unmute video' : 'Mute video'"
            :aria-pressed="!muted"
            @click="toggleSound"
          >
            <VolumeX v-if="muted" :size="15" />
            <Volume2 v-else :size="15" />
          </button>
        </section>

        <aside class="mad-side" aria-label="Connect a local agent">
          <div class="mad-body">
            <header class="mcp-head">
              <DialogTitle class="mcp-title">Connect a local agent</DialogTitle>
              <DialogDescription id="mcp-lead" class="mcp-lead"
                >Let Claude Code, Cursor or any MCP agent run workflows on this build, using your
                nodes, models and templates.</DialogDescription
              >
            </header>
            <div class="mcp-paths">
              <MarSeg v-model="path" :options="PATHS" label="Setup path" />
            </div>

            <template v-if="path === 'have_agent'">
              <section class="mad-sec">
                <h3 class="mad-label">Use Comfy in your agent</h3>
                <ol class="mcp-steps">
                  <li v-for="(s, i) in steps" :key="s.key">
                    <p class="mcp-step">
                      <span class="mcp-step-n" aria-hidden="true">{{ i + 1 }}</span
                      >{{ s.title }}
                    </p>
                    <div v-if="s.command" class="mcp-code">
                      <code>{{ s.command }}</code>
                      <button
                        type="button"
                        class="mcp-copy"
                        aria-label="Copy command"
                        @click="copy(`step-${s.key}`, s.command)"
                      >
                        <Check v-if="copied === `step-${s.key}`" :size="14" />
                        <Copy v-else :size="14" />
                      </button>
                    </div>
                    <p v-if="s.key === 'register'" class="mcp-hint">
                      Using Cursor or Claude Desktop?
                      <button type="button" class="mcp-link" @click="copy('json', snippets.json)">
                        {{ copied === 'json' ? 'Copied' : 'Copy the JSON config' }}
                      </button>
                    </p>
                  </li>
                </ol>
              </section>
              <section class="mad-sec">
                <div class="mcp-terminal">
                  <h3 class="mcp-terminal-title">Or run it in the Comfy terminal</h3>
                  <p class="mcp-hint">
                    Installs into this build's Python, then starts Claude Code.
                  </p>
                  <div class="mcp-terminal-actions">
                    <button
                      type="button"
                      class="mad-btn"
                      :title="snippets.terminal"
                      @click="copy('terminal', snippets.terminal)"
                    >
                      <Check v-if="copied === 'terminal'" :size="14" />
                      <Copy v-else :size="14" />
                      <span>{{ copied === 'terminal' ? 'Copied' : 'Copy command' }}</span>
                    </button>
                    <button type="button" class="mad-btn" @click="openTerminal">
                      <SquareTerminal :size="14" /><span>Open terminal</span>
                    </button>
                  </div>
                </div>
              </section>
            </template>

            <section v-else class="mad-sec">
              <h3 class="mad-label">Install an agent</h3>
              <p class="mcp-body">
                Comfy MCP works with any agent that speaks MCP. Install one, then come back to
                connect it.
              </p>
              <ul class="mcp-agents">
                <li v-for="a in MCP_AGENTS" :key="a.id">
                  <a class="mcp-agent" :href="a.url" target="_blank" rel="noreferrer">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="a.icon" /></svg>
                    <span class="mcp-agent-name">{{ a.name }}</span>
                    <span class="mcp-agent-meta">Install guide</span>
                    <ArrowUpRight :size="14" class="mcp-agent-go" />
                  </a>
                </li>
              </ul>
            </section>
          </div>

          <footer class="mad-actions mcp-foot">
            <a
              class="mad-btn"
              href="https://docs.comfy.org/agent-tools/mcp#local-comfy-mcp-connection"
              target="_blank"
              rel="noreferrer"
              ><span>Read the docs</span><ArrowUpRight :size="14"
            /></a>
          </footer>
        </aside>

        <DialogClose class="mad-x" aria-label="Close"><X :size="18" /></DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
