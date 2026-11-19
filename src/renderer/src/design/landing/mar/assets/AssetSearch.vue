<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Clock, Search, X } from 'lucide-vue-next'
import { cn } from '../../ui/cn'
import { floatingSurface } from '../../ui/menu.styles'

/**
 * Search (Assets): the names, as the PRD asks (Better Asset Management,
 * P2-03), and nothing more; filters live in the Filters menu beside it.
 * Focused and empty, it offers the recent searches.
 */
const query = defineModel<string>('query', { required: true })

const recent = ref<string[]>([])
const open = ref(false)
const shown = computed(() => open.value && !query.value.trim() && recent.value.length > 0)

// ⌘/ or Ctrl+/ finds the field from anywhere on the page.
const field = ref<HTMLInputElement>()
const mac = /Mac|iPhone|iPad/.test(navigator.platform)
function onKey(e: KeyboardEvent): void {
  if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    field.value?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function remember(): void {
  const q = query.value.trim()
  if (q) recent.value = [q, ...recent.value.filter((r) => r !== q)].slice(0, 4)
}
function close(): void {
  open.value = false
  remember()
}
// Clicks inside the list keep the focus in the field.
const keep = (e: MouseEvent): void => e.preventDefault()
function onEsc(e: KeyboardEvent): void {
  if (query.value) query.value = ''
  else (e.target as HTMLInputElement).blur()
}
</script>

<template>
  <div class="asr" @focusout="close">
    <label class="mar-pfind asr-field">
      <Search :size="14" />
      <input
        ref="field"
        v-model="query"
        type="search"
        placeholder="Search"
        aria-label="Search assets by name"
        @focus="open = true"
        @keydown.esc="onEsc"
        @keydown.enter="remember"
      />
      <kbd v-if="!query" class="asr-kbd">{{ mac ? '⌘' : 'Ctrl' }} /</kbd>
      <button
        v-if="query"
        type="button"
        class="mar-pfind-x"
        aria-label="Clear search"
        @mousedown="keep"
        @click="query = ''"
      >
        <X :size="13" />
      </button>
    </label>
    <div
      v-if="shown"
      :class="cn(floatingSurface, 'asr-pop')"
      role="menu"
      aria-label="Recent searches"
      @mousedown="keep"
    >
      <p class="asr-label">Recent</p>
      <button
        v-for="r in recent"
        :key="r"
        type="button"
        role="menuitem"
        class="asr-row"
        @click="query = r"
      >
        <Clock :size="14" class="asr-icon" /><span class="asr-grow">{{ r }}</span>
      </button>
    </div>
  </div>
</template>

<style>
.asr {
  position: relative;
}
:root .proto-ui.proto-ui.proto-ui .asr-field {
  width: 240px;
}
.asr-pop {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  display: flex;
  width: 240px;
  flex-direction: column;
  gap: 1px;
  font-size: 13px;
}
.asr-label {
  padding: 8px 8px 4px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
:root .proto-ui.proto-ui.proto-ui .asr-row {
  display: flex;
  min-height: 30px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: 6px;
  background: transparent;
  color: var(--color-base-foreground);
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .asr-row:hover {
  background: var(--color-secondary-background);
}
.asr-grow {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asr-icon {
  flex: none;
  color: var(--color-muted-foreground);
}
.asr-kbd {
  flex: none;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-subtle-foreground);
  font-family: inherit;
  font-size: 11px;
}
</style>
