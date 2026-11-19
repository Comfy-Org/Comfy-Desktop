<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import { go, proto, toast, type Page } from '../../useProto'
import { can } from '../../milestones'
import { PROJECTS } from '../../mock'
import { SPACES } from '../../spaces'
import portraitSeaside from '../assets/portrait-seaside.jpg'
import lakeFog from '../assets/lake-fog.jpg'
import portraitWindow from '../assets/portrait-window.jpg'
import portraitGrass from '../assets/portrait-grass.jpg'
import hillsFog from '../assets/hills-fog.jpg'

/**
 * 01 · Studio rail (Figma 116:1531): on the collapsed rail, Projects and
 * Spaces show one icon per item; hovering (or focusing) a group opens it
 * as a floating panel next to the rail, with names, counts and a way to
 * add one. Clicking an icon goes straight to it. The rail's own rows for
 * these groups are hidden while this is on (styles below).
 */
type GroupId = 'projects' | 'spaces'
interface Entry {
  id: string
  name: string
  page: Page
  art?: string
  color?: string
  meta?: string
}
interface Group {
  id: GroupId
  title: string
  entries: Entry[]
  /** How many show as icons on the rail. */
  shown: number
  add: { label: string; run: () => void }
}

// Same photos as the expanded sidebar, so each project keeps its face.
const ART = [portraitSeaside, lakeFog, portraitWindow, portraitGrass, hillsFog]

const groups = computed<Group[]>(() => {
  if (proto.mode !== 'create') return []
  const out: Group[] = []
  if (can.value.projects)
    out.push({
      id: 'projects',
      title: 'Projects',
      shown: 4,
      entries: PROJECTS.map((p, i) => ({
        id: p.id,
        name: p.name,
        page: `project:${p.id}` as Page,
        art: ART[i % ART.length]!
      })),
      add: { label: 'New project', run: () => toast('New project') }
    })
  if (can.value.spaces)
    out.push({
      id: 'spaces',
      title: 'Spaces',
      shown: SPACES.length,
      entries: SPACES.map((s) => ({
        id: s.id,
        name: s.name,
        page: `space:${s.id}` as Page,
        color: s.brand.color,
        meta: s.status === 'draft' ? 'Draft' : 'Live'
      })),
      add: {
        label: 'New space',
        run: () => {
          proto.creatingSpace = true
        }
      }
    })
  return out
})

const open = ref<GroupId | null>(null)
const hot = ref<string | null>(null)
let closeTimer: ReturnType<typeof setTimeout> | undefined

function show(g: GroupId, id?: string): void {
  clearTimeout(closeTimer)
  open.value = g
  if (id) hot.value = id
}
// A short grace period, so the pointer can cross from the rail to the panel.
function hideSoon(): void {
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    open.value = null
    hot.value = null
  }, 160)
}
function hideNow(): void {
  clearTimeout(closeTimer)
  open.value = null
  hot.value = null
}
onBeforeUnmount(() => clearTimeout(closeTimer))

function pick(e: Entry): void {
  hideNow()
  go(e.page)
}
function onFocusOut(ev: FocusEvent): void {
  const next = ev.relatedTarget as Node | null
  if (!(ev.currentTarget as HTMLElement).contains(next)) hideSoon()
}
const isHere = (e: Entry): boolean => proto.activeTab === 'home' && proto.page === e.page
</script>

<template>
  <div
    v-if="groups.length"
    class="p01-rail"
    :class="[
      groups.some((g) => g.id === 'projects') && 'has-projects',
      groups.some((g) => g.id === 'spaces') && 'has-spaces'
    ]"
  >
    <div
      v-for="g in groups"
      :key="g.id"
      class="p01-group"
      :class="`is-${g.id}`"
      @mouseenter="show(g.id)"
      @mouseleave="hideSoon"
      @focusout="onFocusOut"
      @keydown.esc="hideNow"
    >
      <span class="p01-sep" aria-hidden="true" />
      <button
        v-for="e in g.entries.slice(0, g.shown)"
        :key="e.id"
        type="button"
        class="p01-trigger"
        :class="isHere(e) && 'is-on'"
        :aria-label="e.name"
        :aria-expanded="open === g.id"
        aria-haspopup="menu"
        @mouseenter="hot = e.id"
        @focus="show(g.id, e.id)"
        @click="pick(e)"
      >
        <img v-if="e.art" :src="e.art" alt="" class="p01-thumb" />
        <span v-else class="p01-orb" :style="{ '--orb': e.color }" />
      </button>

      <Transition name="p01-pop">
        <div v-if="open === g.id" class="p01-panel" role="menu" :aria-label="g.title">
          <div class="p01-head">
            <span>{{ g.title }}</span
            ><span class="p01-count">{{ g.entries.length }}</span>
          </div>
          <button
            v-for="e in g.entries"
            :key="e.id"
            type="button"
            role="menuitem"
            class="p01-item"
            :class="[(hot === e.id || isHere(e)) && 'is-hot']"
            @mouseenter="hot = e.id"
            @click="pick(e)"
          >
            <img v-if="e.art" :src="e.art" alt="" class="p01-item-thumb" />
            <span v-else class="p01-orb is-small" :style="{ '--orb': e.color }" />
            <span class="p01-name">{{ e.name }}</span>
            <span v-if="e.meta" class="p01-meta">{{ e.meta }}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            class="p01-item is-add"
            @click="(hideNow(), g.add.run())"
          >
            <Plus :size="14" /><span class="p01-name">{{ g.add.label }}</span>
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.p01-rail {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
}
.p01-group {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding-bottom: 2px;
}
.p01-sep {
  display: block;
  width: 28px;
  height: 1px;
  margin: 8px 0 6px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.p01-thumb {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  object-fit: cover;
}
.p01-orb {
  display: block;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 999px;
  background: radial-gradient(
    circle at 32% 28%,
    color-mix(in oklch, var(--orb) 55%, white),
    var(--orb) 55%,
    color-mix(in oklch, var(--orb) 70%, black)
  );
}
.p01-orb.is-small {
  width: 18px;
  height: 18px;
}
/* Beats the shared menu look (marShell.css): opaque, since the rail
   already blurs what is behind it and a blur can't reach through it. */
.p01-rail .p01-group > .p01-panel.p01-panel {
  position: absolute;
  top: -10px;
  left: calc(100% + 18px);
  z-index: 50;
  display: flex;
  width: 220px;
  flex-direction: column;
  gap: 1px;
  padding: 6px;
  border-radius: 16px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-card-background));
  backdrop-filter: none;
  box-shadow: 0 20px 60px -20px rgb(0 0 0 / 0.7);
  color: var(--color-base-foreground);
  transform-origin: left top;
}
/* An invisible bridge over the gap, so the pointer keeps the panel open. */
.p01-panel::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -20px;
  width: 20px;
}
.p01-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 6px;
  font-size: 13px;
  font-weight: 600;
}
.p01-count {
  color: var(--color-subtle-foreground);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.p01-item-thumb {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 6px;
  object-fit: cover;
}
.p01-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.p01-meta {
  flex-shrink: 0;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.p01-pop-enter-active {
  transition:
    opacity 140ms ease,
    transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.p01-pop-leave-active {
  transition: opacity 100ms ease;
}
.p01-pop-enter-from {
  opacity: 0;
  transform: translateX(-4px) scale(0.98);
}
.p01-pop-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .p01-pop-enter-active {
    transition: opacity 140ms ease;
  }
  .p01-pop-enter-from {
    transform: none;
  }
}
</style>

<style>
/* Pablo's reset wipes padding and width on buttons inside .proto-ui. */
:root .proto-ui.proto-ui.proto-ui .p01-trigger {
  display: inline-flex;
  width: 40px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 10px;
  transition: background-color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p01-trigger:hover,
:root .proto-ui.proto-ui.proto-ui .p01-trigger[aria-expanded='true']:focus-visible {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .p01-trigger.is-on {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .p01-item {
  display: flex;
  width: 100%;
  height: 32px;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  border-radius: 10px;
  color: var(--color-muted-foreground);
  font-size: 13px;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p01-item.is-hot,
:root .proto-ui.proto-ui.proto-ui .p01-item:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p01-item.is-add {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p01-item.is-add:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui :is(.p01-trigger, .p01-item):focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}

/*
 * 01 · Studio rail. The groups sit after the pages, and the rail's own
 * rows for them go: in the rail's list the group labels are its only
 * <div>s, so the last two (Projects, Spaces) and everything after them
 * are this component's.
 */
.mar-side.is-rail:has(> .p01-rail) > .mar-side-scroll {
  flex: 0 1 auto;
}
.mar-side.is-rail > .p01-rail {
  order: 1;
  flex: 1 0 auto;
}
.mar-side.is-rail:has(> .p01-rail) > :is(.mar-side-credits, .mar-side-foot) {
  order: 2;
}
.p01-rail.has-projects.has-spaces ~ .mar-side-scroll > .mar-side-label:nth-last-of-type(2),
.p01-rail.has-projects.has-spaces ~ .mar-side-scroll > .mar-side-label:nth-last-of-type(2) ~ *,
.p01-rail:not(.has-projects.has-spaces) ~ .mar-side-scroll > .mar-side-label:last-of-type,
.p01-rail:not(.has-projects.has-spaces) ~ .mar-side-scroll > .mar-side-label:last-of-type ~ * {
  display: none;
}
</style>
