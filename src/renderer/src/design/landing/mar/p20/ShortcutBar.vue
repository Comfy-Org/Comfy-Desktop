<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { go, proto, type Page } from '../../useProto'
import { search } from '../search/search'
import P15Keycap from './P15Keycap.vue'

/**
 * 15 · Dense pro (Figma 119:2860): a quiet bar at the foot of the window
 * with the shortcuts that matter, and the keys themselves. ? opens the
 * full list. The tighter Home and sidebar for this density live in the
 * unscoped styles below.
 */
interface Hint {
  keys: string[]
  /** Shown between the keys, for a range (1 – 9). */
  range?: boolean
  label: string
  run: () => void
}

const sheet = ref(false)

function focusPrompt(): void {
  document.querySelector<HTMLTextAreaElement>('.mar-prompt textarea')?.focus()
}
/** The nth card in Recently used on Home (1-based). */
function openRecent(n: number): void {
  const cards = document.querySelectorAll<HTMLElement>(
    '.mar-home section > .snap-x > [role="button"]'
  )
  cards[n - 1]?.click()
}

const HINTS: Hint[] = [
  { keys: ['⌘', 'K'], label: 'Command', run: () => (search.open = true) },
  { keys: ['⌘', '↵'], label: 'Run', run: focusPrompt },
  { keys: ['1', '9'], range: true, label: 'Open recent', run: () => openRecent(1) },
  { keys: ['G', 'B'], label: 'Builds', run: () => go('environments') },
  { keys: ['?'], label: 'All shortcuts', run: () => (sheet.value = !sheet.value) }
]

// G then a letter jumps to a page.
const GO: Record<string, { page: Page; label: string }> = {
  h: { page: 'overview', label: 'Home' },
  e: { page: 'explore', label: 'Explore' },
  w: { page: 'workflows', label: 'Workflows' },
  a: { page: 'assets', label: 'Assets' },
  b: { page: 'environments', label: 'Builds' }
}
const ALL: { keys: string[]; label: string }[] = [
  { keys: ['⌘', 'K'], label: 'Search and commands' },
  { keys: ['⌘', '↵'], label: 'Run the prompt' },
  { keys: ['⌘', 'N'], label: 'New workflow' },
  { keys: ['1', '–', '9'], label: 'Open a recent workflow' },
  ...Object.entries(GO).map(([k, v]) => ({
    keys: ['G', k.toUpperCase()],
    label: `Go to ${v.label}`
  })),
  { keys: ['?'], label: 'Show this list' },
  { keys: ['Esc'], label: 'Close' }
]

let gAt = 0
function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return Boolean(el?.closest('input, textarea, select, [contenteditable="true"]'))
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && sheet.value) {
    sheet.value = false
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
  if (e.key === '?') {
    e.preventDefault()
    sheet.value = !sheet.value
    return
  }
  const k = e.key.toLowerCase()
  if (k === 'g') {
    gAt = Date.now()
    return
  }
  if (Date.now() - gAt < 900 && GO[k]) {
    gAt = 0
    sheet.value = false
    go(GO[k].page)
    return
  }
  if (/^[1-9]$/.test(e.key) && proto.page === 'overview' && proto.activeTab === 'home') {
    openRecent(Number(e.key))
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <footer class="p15-bar" aria-label="Keyboard shortcuts">
    <button v-for="h in HINTS" :key="h.label" type="button" class="p15-hint" @click="h.run()">
      <template v-if="h.range">
        <P15Keycap :keys="[h.keys[0]!]" /><span class="p15-dash">–</span
        ><P15Keycap :keys="[h.keys[1]!]" />
      </template>
      <P15Keycap v-else :keys="h.keys" />
      <span>{{ h.label }}</span>
    </button>
  </footer>

  <Transition name="p15-sheet">
    <div v-if="sheet" class="p15-sheet" role="dialog" aria-label="All shortcuts">
      <div class="p15-sheet-head">
        <span>Shortcuts</span>
        <button type="button" class="p15-close" aria-label="Close" @click="sheet = false">
          <X :size="14" />
        </button>
      </div>
      <ul>
        <li v-for="s in ALL" :key="s.label">
          <span>{{ s.label }}</span>
          <P15Keycap :keys="s.keys" />
        </li>
      </ul>
    </div>
  </Transition>
</template>

<style scoped>
.p15-bar {
  position: fixed;
  right: var(--p15-right, 0px);
  bottom: 0;
  left: var(--p15-left, 0px);
  z-index: 30;
  display: flex;
  height: 32px;
  align-items: center;
  gap: 18px;
  padding: 0 20px;
  overflow: hidden;
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(24px) saturate(1.2);
  color: var(--color-subtle-foreground);
  font-size: 12px;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}
.p15-dash {
  color: var(--color-subtle-foreground);
}
.p15-sheet {
  position: fixed;
  bottom: 44px;
  left: calc(var(--p15-left, 0px) + 16px);
  z-index: 46;
  width: 300px;
  padding: 8px;
  border-radius: 16px;
  background: color-mix(
    in oklch,
    color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-card-background)) 86%,
    transparent
  );
  backdrop-filter: blur(28px) saturate(1.3);
  box-shadow: 0 20px 60px -20px rgb(0 0 0 / 0.7);
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  transform-origin: bottom left;
}
.p15-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 6px 8px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.p15-sheet li {
  display: flex;
  height: 30px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 8px;
  border-radius: 8px;
}
.p15-sheet li:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.p15-sheet-enter-active,
.p15-sheet-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
}
.p15-sheet-enter-from,
.p15-sheet-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.98);
}
</style>

<style>
:root .proto-ui.proto-ui.proto-ui .p15-hint {
  display: inline-flex;
  width: auto;
  height: 24px;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  margin: 0 -6px;
  border-radius: 7px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  transition: color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p15-hint:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p15-close {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 7px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p15-close:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui :is(.p15-hint, .p15-close):focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 1px;
}

/*
 * 15 · Dense pro: the bar sits between the sidebar (or rail) and any
 * right panel, and the page leaves room for it.
 */
:root[data-mar-density='dense'][data-mar-ui='on'] {
  --p15-left: 0px;
  --p15-right: 0px;
}
:root[data-mar-density='dense'][data-mar-ui='on'][data-mar-side='open'] {
  --p15-left: 248px;
}
:root[data-mar-density='dense'][data-mar-ui='on'][data-mar-side='rail'] {
  --p15-left: 60px;
}
:root[data-mar-density='dense'][data-mar-ui='on'][data-mar-side-style='floating'] {
  --p15-left: 0px;
}
:root[data-mar-density='dense'][data-mar-ui='on'][data-mar-panel='queue'] {
  --p15-right: 340px;
}
:root[data-mar-density='dense'][data-mar-ui='on'][data-mar-panel='inspector'] {
  --p15-right: 376px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .proto-main.proto-main {
  padding-bottom: 32px;
}
/* The floating sidebar stops above the bar. */
:root[data-mar-density='dense'][data-mar-ui='on'][data-mar-side-style='floating'] .mar-side {
  bottom: 40px;
}

/* Sidebar: shorter rows, quieter group labels, less air between groups. */
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-side {
  gap: 6px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .proto-ui.proto-ui.proto-ui .mar-side-row {
  height: 28px;
  gap: 9px;
  border-radius: 9px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .proto-ui.proto-ui.proto-ui .mar-side-label {
  padding: 12px 12px 4px;
  font-size: 11px;
  letter-spacing: 0.06em;
}
:root[data-mar-density='dense'][data-mar-ui='on']
  .proto-ui.proto-ui.proto-ui
  .is-rail
  .mar-side-label {
  padding: 6px 0 3px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .proto-ui.proto-ui.proto-ui .mar-side-ws {
  height: 44px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .proto-ui.proto-ui.proto-ui .mar-side-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .proto-ui.proto-ui.proto-ui .mar-side-credits {
  height: 28px;
}

/* Home: the greeting is a heading, not a hero; the prompt and the
   sections sit closer; cards are tighter. */
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home > section:first-child {
  padding-top: 32px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home > section:first-child > div {
  padding-top: 0;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home h1.mar-greeting.mar-greeting {
  margin-bottom: 16px;
  padding-top: 0;
  font-size: 26px;
  line-height: 32px;
  letter-spacing: -0.02em;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home .mar-prompt-slot {
  height: 54px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home .mar-prompt {
  padding: 9px 10px 9px 18px;
  border-radius: 22px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home section.mt-10 {
  margin-top: 24px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home section .mb-3\.5 {
  margin-bottom: 10px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home .snap-x {
  gap: 10px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home .snap-x > [role='button'] {
  padding: 3px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home .snap-x > [role='button'] .mt-1 {
  margin-top: 0;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home .snap-x > [role='button'] > div + * {
  padding: 8px 6px 4px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home .grid.gap-3 {
  gap: 8px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-home .grid.gap-2 {
  gap: 6px;
}
:root[data-mar-density='dense'][data-mar-ui='on'] .mar-top-actions {
  transform: scale(0.94);
  transform-origin: top right;
}
</style>
