<script setup lang="ts">
import { computed, ref } from 'vue'
import { Archive, Copy, FolderX, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Select from '../../ui/Select.vue'
import MemberAvatar from '../../parts/MemberAvatar.vue'
import { thumb } from '../../mock'
import { go, instances, type Page } from '../../useProto'
import MarPage from './MarPage.vue'
import MarItemMenu from './MarItemMenu.vue'
import MarStatus, { type ItemStatus } from './MarStatus.vue'
import MarSeg from './MarSeg.vue'
import MarEntityHeader from './MarEntityHeader.vue'
import MarEmpty from './MarEmpty.vue'
import { EMPTY_PICS } from './emptyArt'
import MarWorkflowsPage from './MarWorkflowsPage.vue'
import MarAssetsPage from './MarAssetsPage.vue'
import { projects } from './projectsStore'
import { workflows } from './workflowsStore'
import { assets } from './assetsStore'
import { notify } from './undo'
import { shownState } from './pageState'
import type { MenuLine } from './menu'
import '../table/table.css'

/**
 * One project (Mar's proposal), as a product page: its cover, name and
 * one line of who, where and when; Invite, + Workflow and ⋯ on the right.
 * Then what it made last and what happened in it, and one row of tabs
 * (Workflows · Assets · People) whose filters dock on the same row. The
 * tabs are the library pages narrowed to this project, states included.
 */
const { id } = defineProps<{ id: string }>()
const p = computed(() => projects.items.find((x) => x.id === id))
const build = computed(() => instances.value.find((i) => i.id === p.value?.envId))

const mine = computed(() => workflows.items.filter((w) => w.project === p.value?.name))
const made = computed(() => assets.items.filter((a) => a.project === p.value?.name))

type Tab = 'workflows' | 'assets' | 'people'
const tab = ref<Tab>('workflows')
// Page state Empty shows the project as just made: nothing in it yet.
const fresh = computed(() => shownState.value === 'empty')
const TABS = computed(() => [
  { value: 'workflows' as const, label: 'Workflows', count: fresh.value ? 0 : mine.value.length },
  { value: 'assets' as const, label: 'Assets', count: fresh.value ? 0 : made.value.length },
  { value: 'people' as const, label: 'People', count: p.value?.members.length ?? 0 }
])

// "Runs on" is a quiet picker in the meta line, not a chip.
const BUILDS = computed(() => instances.value.map((i) => ({ value: i.id, label: i.name })))
const envId = computed({
  get: () => p.value?.envId ?? '',
  set: (next: string) => {
    if (!p.value || next === p.value.envId) return
    const project = p.value
    const before = project.envId
    project.envId = next
    notify(`Now runs on ${build.value?.name ?? 'another build'}`, () => (project.envId = before))
  }
})

const people = computed(() => {
  const m = p.value?.members ?? []
  if (m.length <= 1) return 'Only you'
  return m.length === 2 ? `${m[0]} and ${m[1]}` : `${m[0]} and ${m.length - 1} others`
})

/* ---- What it made last, and what happened in it ---- */
const latest = computed(() => {
  const a = [...made.value].filter((x) => x.thumbId).sort((x, y) => x.age - y.age)[0]
  if (a) return { src: thumb(a.thumbId!), name: a.name, when: a.when, status: a.status }
  const w = [...mine.value].filter((x) => x.thumbId).sort((x, y) => x.age - y.age)[0]
  return w ? { src: thumb(w.thumbId), name: w.name, when: w.modified, status: w.status } : undefined
})

const VERB: Partial<Record<ItemStatus, string>> = {
  executing: 'is running',
  running: 'is running',
  queued: 'queued',
  completed: 'ran',
  failed: 'had a failed run of',
  draft: 'started',
  shared: 'shared'
}
interface Event {
  who: string
  verb: string
  what: string
  when: string
  status?: ItemStatus
  thumbId?: string
}
const activity = computed<Event[]>(() => {
  const m = p.value?.members ?? ['You']
  const rows: (Event & { age: number })[] = [
    ...mine.value.map((w, i) => ({
      who: m[i % m.length]!,
      verb: (w.status && VERB[w.status]) ?? 'edited',
      what: w.name,
      when: w.modified,
      status: w.status,
      thumbId: w.thumbId,
      age: w.age
    })),
    ...made.value.slice(0, 3).map((a, i) => ({
      who: m[(i + 1) % m.length]!,
      verb: a.status === 'running' || a.status === 'queued' ? 'is making' : 'made',
      what: a.name,
      when: a.when,
      status: a.status,
      thumbId: a.thumbId,
      age: a.age
    }))
  ]
  return rows.sort((a, b) => a.age - b.age).slice(0, 4)
})
const showOverview = computed(
  () => shownState.value === 'live' && tab.value !== 'people' && !!latest.value
)

/* ---- Rename, new workflow, the ⋯ menu ---- */
const renaming = ref(false)
const draft = ref('')
function startRename(): void {
  draft.value = p.value?.name ?? ''
  renaming.value = true
}
function commit(): void {
  if (!renaming.value || !p.value) return
  renaming.value = false
  const old = p.value.name
  projects.rename(p.value.id, draft.value)
  // Things inside follow the project's new name.
  for (const w of workflows.items) if (w.project === old) w.project = p.value.name
  for (const a of assets.items) if (a.project === old) a.project = p.value.name
}
function newWorkflow(): void {
  if (!p.value) return
  workflows.items.unshift({
    id: `wf-${Date.now()}`,
    name: 'Untitled workflow',
    source: build.value?.kind === 'cloud' ? 'cloud' : 'local',
    thumbId: '',
    category: 'image',
    project: p.value.name,
    modified: 'Just now',
    age: 0,
    envId: p.value.envId,
    status: 'draft',
    statusLabel: 'Unsaved'
  })
  tab.value = 'workflows'
  notify(`New workflow in ${p.value.name}`)
}

const lines = computed<MenuLine[]>(() =>
  p.value
    ? [
        { label: 'Rename', icon: Pencil, run: startRename },
        { label: 'Duplicate', icon: Copy, run: () => projects.duplicate(p.value!.id) },
        'sep',
        {
          label: 'Archive',
          icon: Archive,
          run: () => {
            p.value!.archived = true
            go('projects')
          }
        },
        {
          label: 'Delete project',
          icon: Trash2,
          danger: true,
          run: () => projects.remove([p.value!.id])
        }
      ]
    : []
)

/* ---- People: roles you can change, an invite row on top ---- */
type Role = 'edit' | 'run'
const ROLES = [
  { value: 'edit' as const, label: 'Can edit' },
  { value: 'run' as const, label: 'Can run' }
]
const roles = ref<Record<string, Role>>({ Mia: 'edit' })
const roleOf = (m: string): Role => roles.value[m] ?? 'run'
const invited = ref<string[]>([])
// Invited people show the address they were invited at.
const emails = ref<Record<string, string>>({})
const emailOf = (m: string): string => emails.value[m] ?? `${m.toLowerCase()}@example.com`
const email = ref('')
const inviteRole = ref<Role>('edit')
function invite(): void {
  const project = p.value
  const who = email.value.trim()
  if (!project || !who) return
  const name = who.split('@')[0]!.replace(/^\w/, (c) => c.toUpperCase())
  project.members.push(name)
  roles.value[name] = inviteRole.value
  emails.value[name] = who
  invited.value.push(name)
  email.value = ''
  notify(`Invited ${who}`, () => project.members.splice(project.members.indexOf(name), 1))
}
function removePerson(m: string): void {
  const project = p.value
  if (!project) return
  const at = project.members.indexOf(m)
  project.members.splice(at, 1)
  notify(`Removed ${m} from ${project.name}`, () => project.members.splice(at, 0, m))
}
</script>

<template>
  <!-- Deleted while open (or a stale link): say so, offer the way back. -->
  <MarPage
    v-if="!p"
    title="Project"
    state="empty"
    :empty="{
      icon: FolderX,
      title: 'This project is gone',
      text: 'It was deleted or you no longer have access. Undo brings it back if you just deleted it.',
      action: 'All projects'
    }"
    @action="go('projects')"
  />
  <div v-else class="mar-proj mx-auto w-full max-w-300 px-10 pb-24">
    <MarEntityHeader
      back="Projects"
      :title="p.name"
      :status="p.archived ? 'paused' : undefined"
      :status-label="p.archived ? 'Archived' : undefined"
      @back="go('projects' as Page)"
    >
      <template #cover><img :src="p.art" alt="" /></template>
      <template #title>
        <input
          v-if="renaming"
          v-model="draft"
          class="mar-proj-rename"
          aria-label="Project name"
          autofocus
          @keydown.enter.prevent="commit"
          @keydown.esc.prevent="renaming = false"
          @blur="commit"
        />
        <template v-else>
          <h1 class="mar-eh-title">{{ p.name }}</h1>
          <button
            type="button"
            class="mar-proj-edit"
            aria-label="Rename project"
            @click="startRename"
          >
            <Pencil :size="13" />
          </button>
        </template>
      </template>
      <template #meta>
        <button type="button" class="mar-eh-link" @click="tab = 'people'">
          <span class="mar-eh-faces">
            <MemberAvatar v-for="m in p.members.slice(0, 4)" :key="m" :name="m" size="sm" />
          </span>
          {{ people }}
        </button>
        <span class="mar-eh-dot" />
        <Select
          v-model="envId"
          :options="BUILDS"
          label="Runs on"
          variant="ghost"
          size="sm"
          class="mar-proj-build"
        />
        <span class="mar-eh-dot" />
        <span>Updated {{ p.updated.toLowerCase() }}</span>
      </template>
      <template #actions>
        <Button @click="tab = 'people'"><UserPlus :size="15" />Invite</Button>
        <Button variant="primary" @click="newWorkflow"><Plus :size="15" />Workflow</Button>
        <MarItemMenu :lines label="Project actions" />
      </template>
    </MarEntityHeader>

    <!-- What it made last, and what happened in it. -->
    <section v-if="showOverview && latest" class="mar-proj-over">
      <button type="button" class="mar-proj-latest" @click="tab = 'assets'">
        <img :src="latest.src" alt="" />
        <span class="mar-proj-latest-cap">
          <span class="mar-proj-eyebrow">Latest output</span>
          <span class="truncate text-ui font-medium text-white">{{ latest.name }}</span>
          <span class="text-ui text-white/70">{{ latest.when }}</span>
        </span>
        <MarStatus
          v-if="latest.status && latest.status !== 'shared'"
          :status="latest.status"
          on-media
          class="mar-proj-latest-status"
        />
      </button>
      <div class="mar-proj-feed">
        <h2 class="mar-proj-eyebrow">Recent activity</h2>
        <ol class="flex flex-col">
          <!-- Who and when on top, what below, the thing itself on the right. -->
          <li v-for="(e, i) in activity" :key="i" class="mar-proj-event">
            <MemberAvatar :name="e.who" size="sm" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-ui text-muted-foreground">
                <b class="font-medium text-base-foreground">{{ e.who }}</b> {{ e.verb }}
                <span class="mar-proj-event-when">· {{ e.when }}</span>
              </span>
              <span class="truncate text-ui text-base-foreground">{{ e.what }}</span>
            </span>
            <span class="mar-proj-event-thumb">
              <img v-if="e.thumbId" :src="thumb(e.thumbId)" alt="" />
              <span
                v-if="e.status === 'running' || e.status === 'executing' || e.status === 'queued'"
                :class="['mar-proj-event-live', e.status === 'queued' && 'is-queued']"
                :aria-label="e.status === 'queued' ? 'Queued' : 'Running'"
              />
            </span>
          </li>
        </ol>
      </div>
    </section>

    <!-- One row: the sections left, the open section's filters right. -->
    <div class="mar-eh-row">
      <MarSeg v-model="tab" :options="TABS" label="In this project" />
      <div id="mar-proj-tools" class="ml-auto flex min-w-0 items-center" />
    </div>

    <MarWorkflowsPage v-if="tab === 'workflows'" :key="`w-${p.name}`" :project="p.name" />
    <MarAssetsPage v-else-if="tab === 'assets'" :key="`a-${p.name}`" :project="p.name" />
    <MarPage
      v-else
      title="People"
      embedded
      skeleton="list"
      :state="shownState === 'empty' ? 'live' : undefined"
      error-text="Who's in this project lives in Comfy Cloud. It comes back when you reconnect."
    >
      <div class="mar-people">
        <!-- Invite: one field, the role and the button inside it. -->
        <form class="mar-invite" @submit.prevent="invite">
          <!-- A div, not a label: the shell fills focused labels. -->
          <div class="mar-invite-field">
            <UserPlus :size="15" class="shrink-0 text-subtle-foreground" />
            <input
              v-model="email"
              type="email"
              placeholder="Invite by email"
              aria-label="Email to invite"
            />
          </div>
          <Select
            v-model="inviteRole"
            :options="ROLES"
            variant="ghost"
            size="sm"
            class="mar-invite-role"
          />
          <Button variant="primary" size="sm" type="submit" :disabled="!email.trim()">
            Invite
          </Button>
        </form>
        <p class="mar-people-note">
          People here see this project’s workflows and assets, nothing else.
        </p>

        <!-- Members: the one table pattern (mar/table/table.css). -->
        <div class="mar-table mar-people-table">
          <div class="mar-table-head">
            <span class="col-span-2"
              >{{ p.members.length }} {{ p.members.length === 1 ? 'member' : 'members' }}</span
            >
            <span />
            <span class="mar-person-owner">Role</span>
            <span />
          </div>
          <div v-for="(m, i) in p.members" :key="m" class="mar-table-row mar-person">
            <MemberAvatar :name="m" class="is-center" />
            <span class="mar-table-name">
              <span class="mar-table-title"
                >{{ m
                }}<span v-if="i === 0" class="font-normal text-subtle-foreground">
                  (you)</span
                ></span
              >
              <span class="mar-table-sub">{{ emailOf(m) }}</span>
            </span>
            <span class="mar-table-cell">
              <MarStatus v-if="invited.includes(m)" status="queued" label="Invite sent" />
            </span>
            <span class="mar-table-cell mar-person-role">
              <span v-if="i === 0" class="mar-person-owner">Owner</span>
              <Select
                v-else
                :model-value="roleOf(m)"
                :options="ROLES"
                variant="ghost"
                size="sm"
                class="w-full"
                @update:model-value="roles[m] = $event"
              />
            </span>
            <span class="mar-table-cell is-end">
              <button
                v-if="i > 0"
                type="button"
                class="mar-person-x"
                :aria-label="`Remove ${m}`"
                @click="removePerson(m)"
              >
                <X :size="14" />
              </button>
            </span>
          </div>
        </div>
        <MarEmpty
          v-if="p.members.length === 1"
          :icon="Users"
          title="Work on this with someone"
          text="Invite people by email above. They see this project’s workflows and assets, nothing else."
          :pics="EMPTY_PICS.people"
          compact
        />
      </div>
    </MarPage>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-proj-edit {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
  opacity: 0;
}
:root .proto-ui.proto-ui.proto-ui .mar-proj-edit:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-eh-head:hover .mar-proj-edit,
:root .proto-ui.proto-ui.proto-ui .mar-proj-edit:focus-visible {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mar-proj-rename {
  width: min(420px, 100%);
  height: 38px;
  margin-left: -8px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-control);
  background: var(--color-content-background);
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
  color: var(--color-base-foreground);
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.02em;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .mar-eh-meta .mar-proj-build:hover,
:root .proto-ui.proto-ui.proto-ui .mar-eh-meta .mar-proj-build[data-state='open'] {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
/* Beats the shell's filled selects: this one reads as text until hovered. */
:root .proto-ui.proto-ui.proto-ui .mar-eh-meta .mar-proj-build {
  height: 26px;
  margin: 0 -4px;
  backdrop-filter: none;
  border-color: transparent;
  background: transparent;
  padding: 0 6px;
  font-size: 13px;
}

/* Latest output and recent activity */
.mar-proj-over {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 14px;
  margin-bottom: 32px;
}
:root .proto-ui.proto-ui.proto-ui .mar-proj-latest {
  position: relative;
  display: block;
  /* Stretches to the feed beside it, so the two cards share one height. */
  height: 100%;
  min-height: 220px;
  overflow: hidden;
  padding: 0;
  border-radius: var(--radius-card, 14px);
  text-align: left;
}
.mar-proj-latest img {
  /* Out of flow, so the picture fills the card without setting its height. */
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 500ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-proj-latest:hover img {
  transform: scale(1.02);
}
.mar-proj-latest-cap {
  position: absolute;
  inset: auto 0 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 40px 18px 16px;
  background: linear-gradient(to top, rgb(0 0 0 / 0.62), transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-proj-latest-cap .mar-proj-eyebrow {
  color: rgb(255 255 255 / 0.7);
}
.mar-proj-latest-status {
  position: absolute;
  top: 12px;
  left: 12px;
}
.mar-proj-feed {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 16px 10px;
  border-radius: var(--radius-card, 14px);
  background: color-mix(in oklch, var(--color-card-background) 70%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-proj-eyebrow {
  margin: 0;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.mar-proj-feed ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
.mar-proj-feed ol {
  gap: 2px;
}
.mar-proj-event {
  display: flex;
  min-height: 48px;
  align-items: center;
  gap: 12px;
  margin-inline: -8px;
  padding: 6px 8px;
  border-radius: var(--radius-control, 8px);
  line-height: 18px;
  transition: background-color 150ms ease;
}
.mar-proj-event:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
.mar-proj-event-when {
  color: var(--color-subtle-foreground);
  font-variant-numeric: tabular-nums;
}
.mar-proj-event-thumb {
  position: relative;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.mar-proj-event-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* A 36px thumb can't hold the status pill: a dot in the corner says it. */
.mar-proj-event-live {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--color-status-running, #22c55e);
  box-shadow: 0 0 0 1.5px rgb(0 0 0 / 0.55);
}
.mar-proj-event-live.is-queued {
  background: rgb(255 255 255 / 0.8);
}

/* People: a narrow column, the invite on top, members in one list. */
.mar-people {
  display: flex;
  max-width: 720px;
  flex-direction: column;
}
.mar-invite {
  display: flex;
  height: 44px;
  align-items: center;
  gap: 4px;
  padding: 0 6px 0 14px;
  border-radius: calc(var(--mar-tab-radius, 10px) + 2px);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  transition:
    background-color 150ms ease,
    box-shadow 150ms ease;
}
.mar-invite:focus-within {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
.mar-invite-field {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 10px;
}
:root .proto-ui.proto-ui.proto-ui .mar-invite-field input {
  min-width: 0;
  flex: 1;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 13px;
  outline: none;
}
.mar-invite-field input::placeholder {
  color: var(--color-subtle-foreground);
}
.mar-people-note {
  margin: 10px 2px 28px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
/* Members follow the one table; rows hold a role picker, so their cells
   stay centred, and nothing opens on a click. */
.mar-people-table {
  --mar-grid: 32px minmax(0, 1fr) auto 128px 28px;
}
:root .proto-ui.proto-ui.proto-ui .mar-people-table .mar-person {
  align-items: center;
  cursor: default;
}
.mar-person-role {
  display: flex;
  align-items: center;
  overflow: visible;
}
.mar-person-owner {
  padding-left: 11px;
  color: var(--color-muted-foreground);
}
.mar-table-head .mar-person-owner {
  color: inherit;
}
/* Quiet role pickers: text until hovered or open (beats the shell's pills). */
:root .proto-ui.proto-ui.proto-ui :is(.mar-person-role, .mar-invite) button[role='combobox'] {
  height: 30px;
  padding: 0 8px 0 10px;
  border-color: transparent;
  border-radius: var(--mar-tab-item-radius, 7px);
  background: transparent;
  backdrop-filter: none;
  color: var(--color-base-foreground);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui :is(.mar-person-role, .mar-invite) button[role='combobox']:hover,
:root
  .proto-ui.proto-ui.proto-ui
  :is(.mar-person-role, .mar-invite)
  button[role='combobox'][data-state='open'] {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-invite .mar-invite-role {
  width: auto;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-invite button[type='submit'] {
  height: 32px;
  margin-left: 2px;
  padding: 0 14px;
  border-radius: var(--mar-tab-item-radius, 7px);
}
:root .proto-ui.proto-ui.proto-ui .mar-person-x {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--radius-control);
  color: var(--color-subtle-foreground);
  opacity: 0;
}
.mar-person:hover .mar-person-x,
:root .proto-ui.proto-ui.proto-ui .mar-person-x:focus-visible {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mar-person-x:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
</style>
