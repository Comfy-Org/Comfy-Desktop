<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowUpRight,
  ChevronLeft,
  Globe,
  Copy,
  EllipsisVertical,
  Eye,
  Rocket,
  Sparkles,
  Users,
  Waypoints
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Badge from '../ui/Badge.vue'
import Button from '../ui/Button.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import Meter from '../ui/Meter.vue'
import Tabs from '../ui/Tabs.vue'
import MemberAvatar from '../parts/MemberAvatar.vue'
import AppRunPanel from '../parts/apps/AppRunPanel.vue'
import { thumb } from '../mock'
import { go, hostActions, instanceById, toast } from '../useProto'
import {
  accessLabel,
  openAppUrl,
  openAsVisitor,
  copyLink,
  dialogs,
  libApp,
  payerLabel,
  startFromName,
  usd,
  type LibApp
} from '../appFlow'

/**
 * One app, one page. Everyone gets Run; the line under it says who pays.
 * The creator also gets Activity, Access, Versions and API.
 */
const { id } = defineProps<{ id: string }>()
// The store's record (ModePages keys this page by id).
const app: LibApp = libApp(id)!
const yours = computed(() => app.group === 'yours')
type Tab = 'run' | 'activity' | 'access' | 'versions' | 'api'
const tab = ref<Tab>('run')

const payer = computed(() => {
  if (app.group === 'shared') return `About ${usd(app.cost)} a run, from your credits`
  if (app.group === 'team') return 'Paid by Silverside · team credits · 38 runs left this month'
  if (app.state === 'draft') return 'Paid by you while it is a draft'
  return app.team ? 'Paid by Silverside · team credits' : 'Paid by you'
})
const spentThisMonth = computed(() => app.history.reduce((n, r) => n + r.cost, 0) * 31)

function publishDraft(): void {
  app.state = 'live'
  toast(`${app.name} is live for only you. Share it when you are ready.`)
}
function publishUpdate(): void {
  app.version++
  app.unpublished = false
  toast(`Version ${app.version} is live. People get it on their next run.`)
}
function revokeAll(): void {
  app.link = false
  app.people = []
  app.team = false
  toast('Access revoked. Runs in progress stop. People keep their past results.')
}
function asVisitor(): void {
  openAsVisitor(app.id)
}
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <button
      type="button"
      class="mt-8 inline-flex items-center gap-1 text-ui text-muted-foreground outline-none hover:text-base-foreground focus-visible:text-base-foreground"
      @click="go('apps')"
    >
      <ChevronLeft :size="14" />Apps
    </button>

    <header class="flex items-end justify-between gap-6 pt-5 pb-8">
      <div class="flex min-w-0 items-center gap-4">
        <img
          :src="thumb(app.thumbId)"
          alt=""
          class="aspect-[4/3] w-20 shrink-0 rounded-control border border-border-default object-cover"
        />
        <div class="min-w-0">
          <div class="flex items-center gap-2.5">
            <h1 class="truncate text-title font-semibold tracking-[-0.01em]">{{ app.name }}</h1>
            <Badge v-if="app.state === 'draft'">Draft</Badge>
            <Badge v-else variant="outline"
              ><span class="size-1.5 rounded-full bg-status-running" />Live</Badge
            >
          </div>
          <p class="mt-1 truncate text-ui text-muted-foreground">
            {{ app.blurb }} · by {{ app.owner === 'You' ? 'you' : app.owner }}
          </p>
          <!-- The app is a website: its URL, one click away -->
          <div v-if="app.state === 'live'" class="mt-2 flex items-center gap-1">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-min font-mono text-ui text-base-foreground underline decoration-border-strong underline-offset-4 outline-none hover:decoration-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
              @click="openAppUrl(app.id)"
            >
              <Globe :size="13" class="text-muted-foreground" />comfy.org/a/{{ app.slug }}
            </button>
            <Button variant="ghost" size="icon-xs" aria-label="Copy link" @click="copyLink(app)"
              ><Copy :size="12"
            /></Button>
          </div>
          <p v-else class="mt-2 text-ui text-subtle-foreground">
            No URL yet. Publish it to get one.
          </p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <template v-if="app.state === 'live'">
          <Button v-if="yours" size="lg" @click="dialogs.share = app.id"
            ><Users :size="14" />Share</Button
          >
          <Button variant="primary" size="lg" class="px-5" @click="openAppUrl(app.id)"
            >Open app<ArrowUpRight :size="15"
          /></Button>
        </template>
        <Button v-else variant="primary" size="lg" @click="publishDraft"
          ><Rocket :size="14" />Publish</Button
        >
        <DropdownMenuRoot v-if="yours" :modal="false">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" aria-label="More"
              ><EllipsisVertical :size="15"
            /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-60">
            <DropdownMenuItem @select="startFromName('product-relight-studio', app.thumbId)"
              ><Sparkles :size="14" />Edit with Comfy Agent</DropdownMenuItem
            >
            <DropdownMenuItem
              @select="hostActions.launch(instanceById('local-1')!, 'product-relight-studio')"
              ><Waypoints :size="14" />Edit the workflow in ComfyUI</DropdownMenuItem
            >
            <DropdownMenuItem v-if="app.state === 'live'" @select="asVisitor"
              ><Eye :size="14" />Open as a visitor</DropdownMenuItem
            >
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </div>
    </header>

    <Tabs
      v-if="yours"
      v-model="tab"
      :options="[
        { value: 'run', label: 'Run' },
        { value: 'activity', label: 'Activity' },
        { value: 'access', label: 'Access' },
        { value: 'versions', label: 'Versions' },
        { value: 'api', label: 'API' }
      ]"
    />

    <div class="pt-8">
      <AppRunPanel
        v-if="tab === 'run' || !yours"
        :layout="app.layout"
        :fields="app.fields"
        :thumb-id="app.thumbId"
        :cost="app.cost"
        :payer
      />

      <!-- Activity -->
      <div v-else-if="tab === 'activity'" class="flex flex-col gap-8">
        <div
          class="grid grid-cols-3 gap-px overflow-hidden rounded-card border border-border-default bg-border-default"
        >
          <div
            v-for="s in [
              { label: 'Runs', value: app.runs.toLocaleString('en-US') },
              { label: 'Cost this month', value: usd(spentThisMonth) },
              { label: 'People', value: String(app.people.length + (app.team ? 8 : 0) + 1) }
            ]"
            :key="s.label"
            class="bg-app-background px-5 py-4"
          >
            <p class="text-ui text-subtle-foreground">{{ s.label }}</p>
            <p class="mt-1 text-title font-semibold tabular-nums">{{ s.value }}</p>
          </div>
        </div>
        <div>
          <div
            class="grid h-9 grid-cols-[minmax(0,1fr)_140px_90px_160px] items-center gap-6 border-b border-border-default text-ui text-subtle-foreground"
          >
            <span>Who ran it</span><span>When</span><span class="text-right">Cost</span
            ><span>Paid by</span>
          </div>
          <div
            v-for="r in app.history"
            :key="r.who + r.when"
            class="grid h-11 grid-cols-[minmax(0,1fr)_140px_90px_160px] items-center gap-6 border-b border-border-default text-ui"
          >
            <span class="flex min-w-0 items-center gap-2.5"
              ><MemberAvatar :name="r.who" size="sm" /><span class="truncate">{{
                r.who
              }}</span></span
            >
            <span class="text-muted-foreground">{{ r.when }}</span>
            <span class="text-right tabular-nums text-muted-foreground">{{ usd(r.cost) }}</span>
            <span class="truncate text-muted-foreground">{{ r.paidBy }}</span>
          </div>
          <p v-if="!app.history.length" class="py-12 text-center text-ui text-subtle-foreground">
            No runs yet. Share the link to get the first one.
          </p>
        </div>
      </div>

      <!-- Access -->
      <div v-else-if="tab === 'access'" class="flex max-w-2xl flex-col gap-8">
        <dl class="grid grid-cols-[200px_minmax(0,1fr)] gap-y-4 text-ui">
          <dt class="text-muted-foreground">Who can use it</dt>
          <dd>{{ app.state === 'draft' ? 'Not published' : accessLabel(app) }}</dd>
          <dt class="text-muted-foreground">Who pays</dt>
          <dd>{{ payerLabel(app) }}</dd>
          <template v-if="app.payer === 'you' && (app.link || app.people.length)">
            <dt class="text-muted-foreground">Free runs you pay for</dt>
            <dd class="flex flex-col gap-2">
              <span
                >{{ usd(app.spent) }} of {{ usd(app.cap) }} · {{ app.freeRuns }} per person</span
              >
              <Meter :value="app.spent" :max="app.cap" class="max-w-xs" />
            </dd>
            <dt class="text-muted-foreground">Without an account</dt>
            <dd>{{ app.noAccount ? 'Allowed, inside the cap' : 'Not allowed' }}</dd>
          </template>
        </dl>
        <div class="flex flex-col">
          <p class="mb-2 text-ui font-medium">People</p>
          <div class="flex h-11 items-center gap-3 border-t border-border-default text-ui">
            <MemberAvatar name="Pablo" size="sm" /><span class="flex-1">Pablo (you)</span
            ><span class="text-subtle-foreground">Owner</span>
          </div>
          <div
            v-if="app.team"
            class="flex h-11 items-center gap-3 border-t border-border-default text-ui"
          >
            <span
              class="inline-flex size-6 items-center justify-center rounded-full bg-secondary-background"
              ><Users :size="12"
            /></span>
            <span class="flex-1">Silverside team · 8 people</span
            ><span class="text-subtle-foreground">Can run</span>
          </div>
          <div
            v-for="p in app.people"
            :key="p.email"
            class="flex h-11 items-center gap-3 border-t border-border-default text-ui"
          >
            <MemberAvatar :name="p.name" size="sm" /><span class="flex-1 truncate">{{
              p.email
            }}</span
            ><span class="text-subtle-foreground">{{ p.role }}</span>
          </div>
        </div>
        <div class="flex gap-2">
          <Button @click="dialogs.share = app.id">Manage access…</Button>
          <Button variant="ghost" @click="revokeAll">Revoke all access</Button>
        </div>
      </div>

      <!-- Versions -->
      <div v-else-if="tab === 'versions'" class="flex max-w-2xl flex-col">
        <div
          v-if="app.unpublished"
          class="flex items-center gap-4 border-b border-border-default py-4"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-ui font-medium">Draft · unpublished changes</span>
            <span class="block text-ui text-subtle-foreground"
              >Only you see it. People keep version {{ app.version }}.</span
            >
          </span>
          <Button size="sm" variant="ghost" @click="toast('Trying the draft')">Try it</Button>
          <Button size="sm" variant="primary" @click="publishUpdate">Publish update</Button>
        </div>
        <div
          v-for="v in Array.from({ length: app.version }, (_, i) => app.version - i)"
          :key="v"
          class="flex items-center gap-4 border-b border-border-default py-4"
        >
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2 text-ui font-medium"
              >Version {{ v }}<Badge v-if="v === app.version" variant="outline">Live</Badge></span
            >
            <span class="block text-ui text-subtle-foreground">{{
              v === app.version ? app.updated : `${(app.version - v) * 9} days earlier`
            }}</span>
          </span>
          <Button
            v-if="v !== app.version"
            size="sm"
            variant="ghost"
            @click="toast(`Version ${v} is live again`)"
            >Restore</Button
          >
        </div>
      </div>

      <!-- API -->
      <div v-else class="flex max-w-3xl flex-col gap-4">
        <p class="text-ui text-muted-foreground">
          The same app, called from code. It takes only these inputs, by name. Each call is charged
          to the workspace of the API key.
        </p>
        <pre
          class="overflow-x-auto rounded-card border border-border-default bg-secondary-background/40 p-5 font-mono text-[12px] leading-6 text-muted-foreground"
        >
POST https://api.comfy.org/apps/{{ app.slug }}/runs
{
{{
            app.fields
              .filter((f) => f.on)
              .map(
                (f) =>
                  `  "${f.id}": ${f.kind === 'image' ? '"https://…/photo.png"' : f.kind === 'count' ? 1 : `"${f.options?.[0] ?? 'text'}"`}`
              )
              .join(',\n')
          }}
}</pre
        >
        <div class="flex gap-2">
          <Button @click="toast('Copied the request')"><Copy :size="13" />Copy request</Button>
          <Button variant="ghost" @click="toast('Opening API keys')">API keys</Button>
        </div>
      </div>
    </div>
  </div>
</template>
