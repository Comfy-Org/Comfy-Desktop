<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Laptop,
  LoaderCircle,
  Plus,
  Search,
  Settings2
} from 'lucide-vue-next'
import MarSpin from '../brand/MarSpin.vue'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import type { ProtoInstance } from '../../mock'
import { activeInstance, go, hostActions, instances, proto, requireLogin } from '../../useProto'
import { onCloud } from '../shell/surface'
import { runOnBlocked, runOnHint, runOnMeta, runOnShort } from './runOn'

/**
 * The prompt's Run on picker (Mar's proposal). Builds grouped by where they
 * run: This computer, then Cloud. Each row says what matters for choosing
 * (state · GPU · VRAM) and what picking it costs (time to start, credits).
 * With no local build, This computer invites you to set one up. More than
 * six builds: type to filter. Laid out like the account menu: the build
 * you're on is the raised panel up top; the list holds the others.
 */
const open = ref(false)
const query = ref('')
const filterInput = ref<HTMLInputElement>()

const byRecent = (a: ProtoInstance, b: ProtoInstance): number =>
  Number(b.state === 'running') - Number(a.state === 'running') || a.lastUsedRank - b.lastUsedRank

// A browser can't run local builds: on Cloud, This computer is the install.
const local = computed(() =>
  onCloud.value ? [] : instances.value.filter((i) => i.kind === 'local').sort(byRecent)
)
const cloud = computed(() =>
  instances.value
    .filter((i) => i.kind === 'cloud')
    .sort((a, b) => Number(!!a.deployment) - Number(!!b.deployment) || byRecent(a, b))
)
const only = computed(() => local.value.length + cloud.value.length === 1)
const needsLogin = computed(() => activeInstance.value.kind === 'cloud' && !proto.signedIn)
const filterable = computed(() => local.value.length + cloud.value.length > 6)

const q = computed(() => query.value.trim().toLowerCase())
// The current build lives in the panel, so the list shows the rest, until
// you search, when everything that matches counts.
const match = (i: ProtoInstance): boolean =>
  q.value
    ? `${i.name} ${runOnMeta(i)}`.toLowerCase().includes(q.value)
    : i.id !== activeInstance.value.id
const shownLocal = computed(() => local.value.filter(match))
const shownCloud = computed(() => cloud.value.filter(match))
const showSetup = computed(() => !local.value.length && !q.value)

function choose(i: ProtoInstance): void {
  if (i.kind === 'cloud' && !proto.signedIn) requireLogin()
  else proto.activeInstanceId = i.id
}

function onOpen(v: boolean): void {
  open.value = v
  if (v) window.addEventListener('keydown', redirect, true)
  else {
    window.removeEventListener('keydown', redirect, true)
    query.value = ''
  }
}
onBeforeUnmount(() => window.removeEventListener('keydown', redirect, true))

// Typing while the list is open goes to the filter (ahead of the menu's
// own type-ahead); Down leaves the filter for the list.
function redirect(e: KeyboardEvent): void {
  if (!filterable.value || !filterInput.value || e.target === filterInput.value) return
  if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return
  e.preventDefault()
  e.stopPropagation()
  query.value += e.key
  nextTick(() => filterInput.value?.focus())
}
function toList(e: KeyboardEvent): void {
  const root = (e.target as HTMLElement).closest('[role="menu"]')
  const first = root?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
  if (!first) return
  e.preventDefault()
  first.focus()
}
</script>

<template>
  <!-- One build: nothing to pick, so no menu, just where this runs. -->
  <component
    :is="needsLogin ? 'button' : 'span'"
    v-if="only"
    :type="needsLogin ? 'button' : undefined"
    class="mar-ro-trigger is-static"
    @click="needsLogin && requireLogin()"
  >
    <span class="mar-ro-glyph">
      <LocationIcon :kind="activeInstance.kind" :size="15" />
      <span v-if="activeInstance.state === 'running'" class="mar-ro-dot is-running" />
    </span>
    <span class="mar-ro-trigger-name">{{ runOnShort(activeInstance) }}</span>
    <span v-if="needsLogin" class="mar-ro-quiet">Log in</span>
  </component>
  <DropdownMenuRoot v-else :open="open" :modal="false" @update:open="onOpen">
    <DropdownMenuTrigger as-child>
      <button type="button" class="mar-ro-trigger" :aria-label="`Run on ${activeInstance.name}`">
        <span class="mar-ro-glyph">
          <LocationIcon :kind="activeInstance.kind" :size="15" />
          <span
            v-if="activeInstance.state === 'running'"
            class="mar-ro-dot is-running"
            aria-hidden="true"
          />
        </span>
        <span class="mar-ro-trigger-name">{{ runOnShort(activeInstance) }}</span>
        <span v-if="needsLogin" class="mar-ro-quiet">Log in</span>
        <ChevronDown :size="12" class="mar-ro-quiet" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="mar-ro-menu w-[340px]">
      <div class="mar-ro-current mar-menu-panel">
        <span class="mar-ro-tile">
          <LocationIcon v-if="activeInstance.kind === 'local'" kind="local" :size="18" />
          <LocationIcon v-else-if="activeInstance.deployment" kind="cloud" :size="18" />
          <ComfyCLogo v-else :size="16" />
        </span>
        <span class="mar-ro-text">
          <span class="mar-ro-name">{{ activeInstance.name }}</span>
          <span class="mar-ro-meta"
            ><span
              v-if="activeInstance.kind === 'local' || activeInstance.deployment"
              :class="[
                'mar-ro-dot',
                activeInstance.state === 'running' ? 'is-running' : 'is-stopped'
              ]"
            />{{ runOnMeta(activeInstance) }}</span
          >
        </span>
      </div>

      <label v-if="filterable" class="mar-ro-filter">
        <Search :size="14" />
        <input
          ref="filterInput"
          v-model="query"
          type="text"
          placeholder="Find a build"
          aria-label="Find a build"
          @keydown.down="toList"
        />
      </label>

      <template v-if="shownLocal.length || showSetup">
        <DropdownMenuLabel>This computer</DropdownMenuLabel>
        <DropdownMenuItem
          v-if="showSetup"
          class="mar-ro-row is-setup"
          @select="hostActions.newInstance()"
        >
          <span class="mar-ro-tile"><Laptop :size="16" /></span>
          <span class="mar-ro-text">
            <span class="mar-ro-top">
              <span class="mar-ro-name">Set up this computer</span>
              <span class="mar-ro-hint is-action"
                >{{ onCloud ? 'Install' : 'Set up' }}<ArrowRight :size="13"
              /></span>
            </span>
            <span class="mar-ro-meta">{{
              onCloud ? 'Desktop app · your own GPU, works offline' : 'Your own GPU, works offline'
            }}</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          v-for="i in shownLocal"
          :key="i.id"
          class="mar-ro-row"
          :disabled="!!runOnBlocked(i)"
          @select="choose(i)"
        >
          <span class="mar-ro-tile"><LocationIcon kind="local" :size="18" /></span>
          <span class="mar-ro-text">
            <span class="mar-ro-top">
              <span class="mar-ro-name">{{ i.name }}</span>
              <span v-if="runOnBlocked(i)" class="mar-ro-hint is-blocked">{{
                runOnBlocked(i)
              }}</span>
              <span
                v-else-if="i.id !== activeInstance.id && runOnHint(i)"
                :class="['mar-ro-hint', i.kind === 'cloud' && !proto.signedIn && 'is-action']"
                >{{ runOnHint(i) }}</span
              >
            </span>
            <span class="mar-ro-meta"
              ><MarSpin
                v-if="i.state === 'launching'"
                :icon="LoaderCircle"
                :size="11"
                spin="mar-ro-spin"
              /><span
                v-else-if="i.kind === 'local' || i.deployment"
                :class="['mar-ro-dot', i.state === 'running' ? 'is-running' : 'is-stopped']"
              />{{ runOnMeta(i) }}</span
            >
          </span>
          <Check v-if="i.id === activeInstance.id" :size="14" />
        </DropdownMenuItem>
      </template>

      <template v-if="shownCloud.length">
        <DropdownMenuLabel>Cloud</DropdownMenuLabel>
        <DropdownMenuItem
          v-for="i in shownCloud"
          :key="i.id"
          class="mar-ro-row"
          :disabled="!!runOnBlocked(i)"
          @select="choose(i)"
        >
          <span class="mar-ro-tile">
            <LocationIcon v-if="i.deployment" kind="cloud" :size="18" />
            <ComfyCLogo v-else :size="16" />
          </span>
          <span class="mar-ro-text">
            <span class="mar-ro-top">
              <span class="mar-ro-name">{{ i.name }}</span>
              <span v-if="runOnBlocked(i)" class="mar-ro-hint is-blocked">{{
                runOnBlocked(i)
              }}</span>
              <span
                v-else-if="i.id !== activeInstance.id && runOnHint(i)"
                :class="['mar-ro-hint', i.kind === 'cloud' && !proto.signedIn && 'is-action']"
                >{{ runOnHint(i) }}</span
              >
            </span>
            <span class="mar-ro-meta"
              ><MarSpin
                v-if="i.state === 'launching'"
                :icon="LoaderCircle"
                :size="11"
                spin="mar-ro-spin"
              /><span
                v-else-if="i.kind === 'local' || i.deployment"
                :class="['mar-ro-dot', i.state === 'running' ? 'is-running' : 'is-stopped']"
              />{{ runOnMeta(i) }}</span
            >
          </span>
          <Check v-if="i.id === activeInstance.id" :size="14" />
        </DropdownMenuItem>
      </template>

      <p v-if="q && !shownLocal.length && !shownCloud.length" class="mar-ro-empty">
        No builds match “{{ query.trim() }}”
      </p>

      <DropdownMenuSeparator />
      <DropdownMenuItem @select="hostActions.newInstance()"
        ><Plus :size="15" class="text-subtle-foreground" />Create new build</DropdownMenuItem
      >
      <DropdownMenuItem @select="go('environments')"
        ><Settings2 :size="15" class="text-subtle-foreground" />Manage builds</DropdownMenuItem
      >
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>

<style scoped>
/* Trigger: same corner and pill as the page filters. */
.mar-ro-trigger {
  display: inline-flex;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  border-radius: var(--mar-tab-radius, 10px);
  padding: 0 8px 0 7px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  outline: none;
  transition: background-color 120ms ease;
}
/* Beats the prototype's reset on buttons and inputs (.proto-ui x3). */
:root .proto-ui.proto-ui.proto-ui .mar-ro-trigger {
  font-size: 13px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .mar-ro-filter input {
  font-size: 13px;
}
/* One build: nothing to pick, so it's just where this runs. */
.mar-ro-trigger.is-static {
  padding-right: 9px;
  background: transparent;
  cursor: default;
}
.mar-ro-trigger:hover,
.mar-ro-trigger[data-state='open'] {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
}
.mar-ro-trigger:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mar-ro-trigger-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-ro-quiet {
  color: var(--color-subtle-foreground);
}
.mar-ro-glyph {
  position: relative;
  display: inline-flex;
}
.mar-ro-glyph .mar-ro-dot {
  position: absolute;
  right: -3px;
  bottom: -2px;
  margin: 0;
}

/* Rows. */
.mar-ro-row {
  min-height: 48px;
  gap: 10px;
  padding-block: 7px;
}
/* The build you're on: the account menu's raised panel. */
.mar-ro-current {
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 10px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui, 13px);
  line-height: 1.35;
}
.mar-ro-current .mar-ro-tile {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-ro-tile {
  position: relative;
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: calc(var(--mar-menu-radius, 14px) - var(--mar-menu-pad, 6px));
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-muted-foreground);
}
/* Status sits in the meta line, ahead of the words it qualifies: no
   ring cut into the tile, so nothing depends on the glass behind it. */
.mar-ro-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  margin-right: 6px;
  border-radius: 999px;
  vertical-align: 1px;
}
.mar-ro-dot.is-running {
  background: var(--color-status-running, #22c55e);
}
.mar-ro-dot.is-stopped {
  background: color-mix(in oklch, var(--color-base-foreground) 30%, transparent);
}
.mar-ro-spin {
  display: inline-block;
  margin-right: 5px;
  color: var(--color-base-foreground);
  vertical-align: -1px;
}
@media (prefers-reduced-motion: no-preference) {
  .mar-ro-spin {
    animation: mar-ro-spin 0.9s linear infinite;
  }
}
@keyframes mar-ro-spin {
  to {
    transform: rotate(360deg);
  }
}
.mar-ro-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}
.mar-ro-top {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}
.mar-ro-top .mar-ro-hint {
  margin-left: auto;
}
.mar-ro-name {
  min-width: 0;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-ro-meta {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-ro-hint {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  white-space: nowrap;
}
.mar-ro-hint.is-action {
  color: var(--color-base-foreground);
  font-weight: 500;
}
.mar-ro-hint.is-blocked {
  color: var(--color-muted-foreground);
}
.mar-ro-row.is-setup .mar-ro-tile {
  border: 1px dashed color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
  background: transparent;
}

/* A build that can't take the job: readable, so the reason is too. */
.mar-ro-row[data-disabled] {
  opacity: 1;
}
.mar-ro-row[data-disabled] :is(.mar-ro-tile, .mar-ro-text) {
  opacity: 0.45;
}

/* Filter. */
.mar-ro-filter {
  display: flex;
  height: 34px;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
  border-radius: calc(var(--mar-menu-radius, 14px) - var(--mar-menu-pad, 6px));
  padding: 0 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-subtle-foreground);
}
.mar-ro-filter:focus-within {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
}
.mar-ro-filter input,
.mar-ro-filter input:focus-visible {
  outline: none;
  box-shadow: none;
}
.mar-ro-filter input {
  min-width: 0;
  flex: 1;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: var(--text-ui, 13px);
  outline: none;
}
.mar-ro-filter input::placeholder {
  color: var(--color-subtle-foreground);
}
.mar-ro-empty {
  padding: 10px 10px 8px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui, 13px);
}
</style>
