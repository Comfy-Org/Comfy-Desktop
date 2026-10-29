<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import Button from '@comfyorg/design-system/button/Button'
import '@xterm/xterm/css/xterm.css'
import type { TerminalRestore } from '../../../../types/ipc'
import { TID } from '../../../../shared/testIds'
import { normalizePlatform } from '../../composables/usePlatform'
import { decideTerminalKeyAction } from '../../../../shared/terminalShortcuts'
import ContextMenu from '../../components/ContextMenu.vue'
import type { ContextMenuItem } from '../../types/context-menu'

/** Interactive per-install console. The shell lives in main (one PTY per
 *  installation, shared across windows) and survives ComfyUI being stopped,
 *  so this pane is purely a view onto it. Typing `exit` ends the session;
 *  the restart banner respawns a fresh shell. */

interface Props {
  installationId: string | null
}

const props = defineProps<Props>()

const { t } = useI18n()
const api = window.api

const paneRef = ref<HTMLDivElement | null>(null)
const hostRef = ref<HTMLDivElement | null>(null)
const exited = ref(false)

const platform = normalizePlatform(api.platform)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
const disposers: Array<() => void> = []

function teardown(): void {
  for (const dispose of disposers.splice(0)) dispose()
  resizeObserver?.disconnect()
  resizeObserver = null
  const id = currentId
  if (id) void api.terminalUnsubscribe(id)
  terminal?.dispose()
  terminal = null
  fitAddon = null
  currentId = null
}

let currentId: string | null = null

function applyRestore(restore: TerminalRestore): void {
  if (!terminal) return
  if (restore.size.cols > 0 && restore.size.rows > 0) {
    terminal.resize(restore.size.cols, restore.size.rows)
  }
  if (restore.buffer.length) terminal.write(restore.buffer.join(''))
  exited.value = restore.exited
}

function pushSize(): void {
  if (!terminal || !fitAddon || !currentId) return
  if (!hostRef.value?.offsetParent) return
  const dims = fitAddon.proposeDimensions()
  if (!dims || !dims.cols || !dims.rows) return
  if (dims.cols === terminal.cols && dims.rows === terminal.rows) return
  terminal.resize(dims.cols, dims.rows)
  void api.terminalResize(currentId, dims.cols, dims.rows)
}

/** Force the shared PTY to this view's size. Unlike {@link pushSize}, this skips
 *  the "local dims unchanged" guard: another window may have resized the PTY out
 *  from under us, so on focus we must re-assert our size even if our own xterm
 *  hasn't changed, or the shell's cursor stays misaligned. */
function reclaimPtySize(): void {
  if (!terminal || !currentId) return
  if (!hostRef.value?.offsetParent) return
  void api.terminalResize(currentId, terminal.cols, terminal.rows)
}

const debouncedPushSize = useDebounceFn(pushSize, 50)

/** Read a CSS custom property off :root, trimmed, with a fallback. Lets the
 *  xterm theme track the app's light/dark terminal tokens at attach time. */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Copy the current xterm selection to the clipboard (no-op when empty). */
async function copySelection(): Promise<void> {
  const text = terminal?.getSelection()
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard can reject (permissions / non-secure context); the selection
    // stays highlighted for a manual copy, so swallowing is least surprising.
  }
}

/** Paste the clipboard into the terminal. Used by the right-click menu; the
 *  keyboard paste shortcut is handled natively by xterm (see the key handler).
 *  `terminal.paste()` routes through onData and honors bracketed-paste mode. */
async function pasteClipboard(): Promise<void> {
  const term = terminal
  if (!term) return
  try {
    const text = await navigator.clipboard.readText()
    // Ignore if this view was torn down / swapped to another install during
    // the async clipboard read.
    if (text && term === terminal) term.paste(text)
  } catch {
    // See copySelection: clipboard access can fail; nothing else to do.
  }
}

// --- Right-click menu --------------------------------------------------------
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuHasSelection = ref(false)

const menuItems = computed<ContextMenuItem[]>(() => [
  { id: 'copy', label: t('console.copy'), disabled: !menuHasSelection.value },
  { id: 'paste', label: t('console.paste') },
  { id: 'selectAll', label: t('console.selectAll'), separator: true }
])

function openContextMenu(e: MouseEvent): void {
  if (!terminal) return
  menuHasSelection.value = terminal.hasSelection()
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuOpen.value = true
}

function onMenuSelect(id: string): void {
  switch (id) {
    case 'copy':
      void copySelection()
      break
    case 'paste':
      void pasteClipboard()
      break
    case 'selectAll':
      terminal?.selectAll()
      break
  }
}

async function attach(id: string): Promise<void> {
  if (!hostRef.value) return
  currentId = id

  const bg = cssVar('--neutral-800', '#211927')
  const fg = cssVar('--neutral-100', '#c2bfb9')
  terminal = new Terminal({
    convertEol: true,
    fontFamily: "'Cascadia Mono', 'Consolas', 'SF Mono', ui-monospace, monospace",
    fontSize: 13,
    lineHeight: 1.45,
    theme: {
      background: bg,
      foreground: fg,
      cursor: cssVar('--neutral-200', '#a6a2a1'),
      cursorAccent: bg,
      selectionBackground: cssVar('--terminal-selection', 'rgba(11, 140, 233, 0.28)'),
      black: cssVar('--neutral-950', '#100c13'),
      red: cssVar('--danger', '#e05858'),
      green: cssVar('--success', '#00cd72'),
      yellow: cssVar('--warning', '#fd9903'),
      blue: cssVar('--info', '#58a6ff'),
      magenta: cssVar('--accent-plum', '#afa3db'),
      cyan: cssVar('--info', '#58a6ff'),
      white: fg,
      brightBlack: cssVar('--neutral-400', '#6f6970'),
      brightRed: cssVar('--danger-hover', '#ef6b6b'),
      brightGreen: cssVar('--success', '#00cd72'),
      brightYellow: cssVar('--warning', '#fd9903'),
      brightBlue: cssVar('--accent-hover', '#93c5fd'),
      brightMagenta: cssVar('--accent-plum', '#afa3db'),
      brightCyan: cssVar('--accent-hover', '#93c5fd'),
      brightWhite: cssVar('--text', '#ffffff')
    }
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(hostRef.value)

  // Intercept copy/paste shortcuts before they reach the PTY so e.g. Ctrl+C
  // can copy a selection instead of always sending SIGINT. Returning false
  // tells xterm to swallow the key. See decideTerminalKeyAction for the
  // per-OS matrix.
  terminal.attachCustomKeyEventHandler((e) => {
    const action = decideTerminalKeyAction(e, platform, terminal?.hasSelection() ?? false)
    switch (action) {
      case 'copy':
        void copySelection()
        return false
      case 'paste':
        // xterm pastes natively via the browser's paste event; returning false
        // only swallows the keydown so no stray ^V reaches the PTY. Pasting
        // manually here too would double-paste.
        return false
      case 'swallow':
        return false
      default:
        return true
    }
  })

  disposers.push(terminal.onData((data) => void api.terminalWrite(id, data)).dispose)
  disposers.push(
    api.onTerminalOutput((payload) => {
      if (payload.installationId !== id) return
      // Output only flows from a live shell, so a restart triggered from
      // another window (no exit/start event reaches us) revives the session:
      // clear the "session ended" banner so input works again.
      if (exited.value) exited.value = false
      terminal?.write(payload.data)
    })
  )
  // The PTY is shared with the ComfyUI window's terminal and holds one size.
  // Reclaim it for this view on focus so the shell's cursor matches what we
  // render here.
  terminal.element?.addEventListener('focusin', reclaimPtySize)
  disposers.push(() => terminal?.element?.removeEventListener('focusin', reclaimPtySize))
  disposers.push(
    api.onTerminalExited((payload) => {
      if (payload.installationId === id) exited.value = true
    })
  )

  resizeObserver = new ResizeObserver(() => void debouncedPushSize())
  if (paneRef.value) resizeObserver.observe(paneRef.value)

  pushSize()
  applyRestore(await api.terminalSubscribe(id))
  requestAnimationFrame(pushSize)
}

async function restart(): Promise<void> {
  if (!currentId || !terminal) return
  terminal.reset()
  exited.value = false
  applyRestore(await api.terminalRestart(currentId))
  pushSize()
}

onMounted(() => {
  if (props.installationId) void attach(props.installationId)
})

watch(
  () => props.installationId,
  (next) => {
    teardown()
    exited.value = false
    if (next) void attach(next)
  }
)

onBeforeUnmount(teardown)
</script>

<template>
  <!-- min-w-0 prevents xterm's intrinsic column width from expanding the pane. -->
  <div
    ref="paneRef"
    class="console-pane flex min-h-[240px] w-full min-w-0 flex-auto flex-col overflow-hidden rounded-[10px] border border-solid border-[var(--chooser-surface-border)] bg-[var(--chooser-surface-bg)] [box-shadow:0_0_0_1px_color-mix(in_srgb,var(--neutral-950)_35%,transparent),0_8px_24px_color-mix(in_srgb,var(--neutral-950)_28%,transparent)]"
  >
    <header
      class="console-header flex h-[34px] shrink-0 items-center gap-2.5 border-0 border-b border-solid border-[var(--chooser-surface-border)] bg-[color-mix(in_srgb,var(--neutral-800)_72%,transparent)] px-3.5"
      aria-hidden="true"
    >
      <span
        class="console-header-dots inline-flex items-center gap-[5px] [&>span]:size-[7px] [&>span]:rounded-[50%] [&>span]:bg-[color-mix(in_srgb,var(--neutral-400)_42%,transparent)] [&>span]:[box-shadow:inset_0_1px_0_color-mix(in_srgb,white_8%,transparent)]"
      >
        <span /><span /><span />
      </span>
      <span
        class="console-header-title text-[11px] font-medium tracking-[0.06em] text-[color-mix(in_srgb,var(--text-muted)_88%,transparent)] uppercase"
        >{{ t('console.shellLabel') }}</span
      >
    </header>
    <div
      class="console-viewport relative min-h-0 flex-auto bg-neutral-800 [box-shadow:inset_0_1px_0_color-mix(in_srgb,white_3%,transparent)]"
    >
      <!-- Absolute content-box sizing keeps FitAddon measurements independent of
           xterm's intrinsic dimensions and excludes padding from the inner height. -->
      <div
        ref="hostRef"
        class="console-host absolute inset-0 box-content overflow-hidden px-3.5 pt-3 pb-3.5"
        :data-testid="TID.consoleTerminal"
        @contextmenu.prevent="openContextMenu"
      />
      <div
        v-if="exited"
        class="console-ended absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-0 border-t border-solid border-[var(--chooser-surface-border)] bg-[color-mix(in_srgb,var(--modal-surface-bg)_90%,transparent)] px-3.5 py-2.5 backdrop-blur-[10px]"
        role="status"
        :data-testid="TID.consoleSessionEnded"
      >
        <span
          class="console-ended-text text-[12px] leading-[1.45] text-[var(--text-muted,var(--neutral-100))]"
          >{{ t('console.sessionEnded') }}</span
        >
        <Button
          size="unset"
          variant="textonly"
          type="button"
          class="console-ended-restart static block h-[30px] shrink-0 appearance-auto rounded-lg border border-solid border-[var(--accent)] bg-surface px-3.5 py-0 font-sans text-[12px] leading-[inherit] font-medium whitespace-normal text-[var(--accent)] touch-auto transition-none [&]:[appearance:button] hover:bg-[var(--accent)] hover:text-[var(--bg)] focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto]"
          :data-testid="TID.consoleRestart"
          @click="restart"
        >
          {{ t('console.restartSession') }}
        </Button>
      </div>
    </div>
    <ContextMenu
      :open="menuOpen"
      :x="menuX"
      :y="menuY"
      :items="menuItems"
      @select="onMenuSelect"
      @close="menuOpen = false"
    />
  </div>
</template>

<style scoped>
/* xterm creates this DOM outside Vue and ships unlayered vendor CSS. These
 * integration overrides must stay unlayered so the viewport fits its host and
 * cannot capture pointer events beyond the pane. Component layout is utility-owned. */
.console-host :deep(.xterm) {
  overflow: hidden;
  height: 100%;
}

.console-host :deep(.xterm-viewport) {
  background-color: transparent;
}

.console-host :deep(.xterm-screen) {
  overflow: hidden;
  background-color: var(--neutral-800);
}
</style>
