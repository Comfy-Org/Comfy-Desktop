<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowUpRight,
  ChevronLeft,
  Globe,
  Copy,
  KeyRound,
  Plus,
  EllipsisVertical,
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
import SegmentedControl from '../ui/SegmentedControl.vue'
import Sparkline from '../ui/Sparkline.vue'
import Switch from '../ui/Switch.vue'
import Tabs from '../ui/Tabs.vue'
import MemberAvatar from '../parts/MemberAvatar.vue'
import StatTile from '../parts/env/StatTile.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import AppRunPanel from '../parts/apps/AppRunPanel.vue'
import PreviewAsMenu from '../parts/apps/PreviewAsMenu.vue'
import { thumb } from '../mock'
import { go, hostActions, instanceById, toast } from '../useProto'
import {
  accessLabel,
  openAppUrl,
  copyLink,
  dialogs,
  libApp,
  payerLabel,
  startFromName,
  usd,
  type FieldKind,
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

const seed = [...id].reduce((n, c) => n + c.charCodeAt(0), 0)
const trend = Array.from({ length: 14 }, (_, i) => 20 + ((seed * (i + 3)) % 40) + i * 2)
const NOTES = [
  'Added the Golden hour preset',
  'Sharper edges with the new relight LoRA',
  'Inputs renamed in plain words',
  'First version'
]

// API
const KIND_LABEL: Record<FieldKind, string> = {
  image: 'image URL',
  text: 'text',
  choice: 'one of',
  count: 'number'
}
const lang = ref<'curl' | 'python' | 'js'>('curl')
const endpoint = `https://api.comfy.org/apps/${app.slug}/runs`
const code = computed(() => {
  const url = endpoint
  const pairs = app.fields
    .filter((f) => f.on)
    .map((f) => [
      f.id,
      f.kind === 'image'
        ? 'https://…/photo.png'
        : f.kind === 'count'
          ? 1
          : (f.options?.[0] ?? 'On a marble counter')
    ])
  const json = (indent: string): string =>
    pairs.map(([k, v]) => `${indent}"${k}": ${JSON.stringify(v)}`).join(',\n')
  if (lang.value === 'python')
    return `import requests\n\nrun = requests.post(\n    "${url}",\n    headers={"Authorization": f"Bearer {COMFY_API_KEY}"},\n    json={\n${json('        ')}\n    },\n)\nprint(run.json()["outputs"])`
  if (lang.value === 'js')
    return `const run = await fetch("${url}", {\n  method: "POST",\n  headers: { Authorization: \`Bearer \${COMFY_API_KEY}\` },\n  body: JSON.stringify({\n${json('    ')}\n  })\n})\nconsole.log((await run.json()).outputs)`
  return `curl -X POST ${url} \\\n  -H "Authorization: Bearer $COMFY_API_KEY" \\\n  -d '{\n${json('    ')}\n  }'`
})

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
          <PreviewAsMenu v-if="yours" :app-id="app.id" size="lg" />
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
      <div v-else-if="tab === 'activity'" class="flex flex-col gap-10">
        <div class="grid grid-cols-4 divide-x divide-border-default border-y border-border-default">
          <StatTile label="Runs" :value="app.runs.toLocaleString('en-US')"
            ><Sparkline :values="trend"
          /></StatTile>
          <StatTile label="Cost this month" :value="usd(spentThisMonth)" />
          <StatTile label="People" :value="String(app.people.length + (app.team ? 8 : 0) + 1)" />
          <StatTile label="Average run" value="18 s" />
        </div>

        <section>
          <SectionHeader title="Latest runs" />
          <div
            class="flex h-10 items-center gap-6 border-b border-border-default text-ui text-subtle-foreground"
          >
            <span class="flex-1">Who ran it</span><span class="w-36">When</span
            ><span class="w-20 text-right">Cost</span><span class="w-44">Paid by</span>
          </div>
          <div
            v-for="r in app.history"
            :key="r.who + r.when"
            class="flex min-h-14 items-center gap-6 border-b border-border-default py-3"
          >
            <span class="flex min-w-0 flex-1 items-center gap-2.5">
              <MemberAvatar :name="r.who" size="sm" /><span class="truncate text-ui">{{
                r.who
              }}</span>
            </span>
            <span class="w-36 text-ui text-muted-foreground">{{ r.when }}</span>
            <span class="w-20 text-right text-ui text-muted-foreground tabular-nums">{{
              usd(r.cost)
            }}</span>
            <span class="w-44 truncate text-ui text-muted-foreground">{{ r.paidBy }}</span>
          </div>
          <p v-if="!app.history.length" class="py-12 text-center text-ui text-subtle-foreground">
            No runs yet. Share the link to get the first one.
          </p>
        </section>
      </div>

      <!-- Access -->
      <div v-else-if="tab === 'access'" class="flex flex-col gap-10">
        <section>
          <SectionHeader title="Sharing" />
          <div
            class="flex min-h-14 items-center gap-6 border-b border-border-default py-3 border-t"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-ui font-medium">Who can use it</span>
              <span class="block text-ui text-subtle-foreground"
                >Everyone else gets “You need access”.</span
              >
            </span>
            <span class="text-ui">{{
              app.state === 'draft' ? 'Not published' : accessLabel(app)
            }}</span>
            <Button size="sm" @click="dialogs.share = app.id">Change</Button>
          </div>
          <div class="flex min-h-14 items-center gap-6 border-b border-border-default py-3">
            <span class="min-w-0 flex-1">
              <span class="block text-ui font-medium">Who pays</span>
              <span class="block text-ui text-subtle-foreground">Charged at cost, no markup.</span>
            </span>
            <span class="text-ui">{{ payerLabel(app) }}</span>
          </div>
          <div
            v-if="app.payer === 'you' && (app.link || app.people.length)"
            class="flex min-h-14 items-center gap-6 border-b border-border-default py-3"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-ui font-medium">Free runs you pay for</span>
              <span class="block text-ui text-subtle-foreground"
                >{{ app.freeRuns }} per person, up to the cap.</span
              >
            </span>
            <Meter :value="app.spent" :max="app.cap" class="w-48" />
            <span class="w-32 text-right text-ui tabular-nums"
              >{{ usd(app.spent) }} of {{ usd(app.cap) }}</span
            >
          </div>
          <div class="flex min-h-14 items-center gap-6 border-b border-border-default py-3">
            <span class="min-w-0 flex-1">
              <span class="block text-ui font-medium">Runs without an account</span>
              <span class="block text-ui text-subtle-foreground"
                >Only for free runs you pay for. Results stay for 24 hours.</span
              >
            </span>
            <Switch v-model="app.noAccount" aria-label="Runs without an account" />
          </div>
        </section>

        <section>
          <SectionHeader title="People">
            <template #controls>
              <Button size="sm" class="ml-auto" @click="dialogs.share = app.id"
                ><Plus :size="13" />Invite</Button
              >
            </template>
          </SectionHeader>
          <div
            class="flex min-h-14 items-center gap-6 border-b border-border-default py-3 border-t"
          >
            <span class="flex min-w-0 flex-1 items-center gap-2.5">
              <MemberAvatar name="Pablo" size="sm" /><span class="text-ui">Pablo (you)</span>
              <span class="text-ui text-subtle-foreground">pablo@silverside.studio</span>
            </span>
            <span class="text-ui text-muted-foreground">Owner</span>
          </div>
          <div
            v-if="app.team"
            class="flex min-h-14 items-center gap-6 border-b border-border-default py-3"
          >
            <span class="flex min-w-0 flex-1 items-center gap-2.5">
              <span
                class="inline-flex size-5 items-center justify-center rounded-full bg-secondary-background"
                ><Users :size="11"
              /></span>
              <span class="text-ui">Silverside team</span>
              <span class="text-ui text-subtle-foreground">8 people · team credits pay</span>
            </span>
            <span class="text-ui text-muted-foreground">Can run</span>
          </div>
          <div
            v-for="pp in app.people"
            :key="pp.email"
            class="flex min-h-14 items-center gap-6 border-b border-border-default py-3"
          >
            <span class="flex min-w-0 flex-1 items-center gap-2.5">
              <MemberAvatar :name="pp.name" size="sm" /><span class="truncate text-ui">{{
                pp.email
              }}</span>
              <span class="text-ui text-subtle-foreground">Outside the team</span>
            </span>
            <span class="text-ui text-muted-foreground">{{ pp.role }}</span>
          </div>
        </section>

        <section>
          <div
            class="flex min-h-14 items-center gap-6 border-b border-border-default py-3 border-t"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-ui font-medium">Revoke all access</span>
              <span class="block text-ui text-subtle-foreground"
                >Runs in progress stop. People keep their past results.</span
              >
            </span>
            <Button size="sm" @click="revokeAll">Revoke all</Button>
          </div>
        </section>
      </div>

      <!-- Versions -->
      <section v-else-if="tab === 'versions'">
        <div
          class="flex h-10 items-center gap-6 border-b border-border-default text-ui text-subtle-foreground border-t"
        >
          <span class="flex-1">Version</span><span class="w-40">Published</span
          ><span class="w-28" />
        </div>
        <div
          v-if="app.unpublished"
          class="flex min-h-14 items-center gap-6 border-b border-border-default py-3"
        >
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2 text-ui font-medium"
              >Draft<Badge>Unpublished changes</Badge></span
            >
            <span class="block text-ui text-subtle-foreground"
              >Only you see it. People keep version {{ app.version }} until you publish.</span
            >
          </span>
          <span class="w-40 text-ui text-muted-foreground">Not yet</span>
          <span class="flex w-28 justify-end"
            ><Button size="sm" variant="primary" @click="publishUpdate">Publish</Button></span
          >
        </div>
        <div
          v-for="v in Array.from({ length: app.version }, (_, i) => app.version - i)"
          :key="v"
          class="flex min-h-14 items-center gap-6 border-b border-border-default py-3"
        >
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2 text-ui font-medium"
              >Version {{ v }}<Badge v-if="v === app.version" variant="outline">Live</Badge></span
            >
            <span class="block text-ui text-subtle-foreground">{{
              NOTES[(app.version - v) % NOTES.length]
            }}</span>
          </span>
          <span class="w-40 text-ui text-muted-foreground">{{
            v === app.version ? app.updated : `${(app.version - v) * 9} days earlier`
          }}</span>
          <span class="flex w-28 justify-end">
            <Button
              v-if="v !== app.version"
              size="sm"
              variant="ghost"
              @click="toast(`Version ${v} is live again`)"
              >Restore</Button
            >
          </span>
        </div>
      </section>

      <!-- API -->
      <div v-else class="flex flex-col gap-10">
        <section>
          <SectionHeader title="Endpoint" />
          <div
            class="flex min-h-14 items-center gap-6 border-b border-border-default py-3 border-t"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-ui font-medium">URL</span>
              <span class="block text-ui text-subtle-foreground"
                >Takes only the inputs below, by name. Each call is charged to the API key’s
                workspace.</span
              >
            </span>
            <code class="truncate font-mono text-ui">POST {{ endpoint }}</code>
            <Button variant="ghost" size="icon-sm" aria-label="Copy URL" @click="toast('Copied')"
              ><Copy :size="13"
            /></Button>
          </div>
          <div class="flex min-h-14 items-center gap-6 border-b border-border-default py-3">
            <span class="min-w-0 flex-1">
              <span class="block text-ui font-medium">API keys</span>
              <span class="block text-ui text-subtle-foreground"
                >Keys belong to the workspace.</span
              >
            </span>
            <Button size="sm" @click="toast('Opening API keys')"
              ><KeyRound :size="13" />Manage keys</Button
            >
          </div>
        </section>

        <section>
          <SectionHeader title="Inputs" />
          <div
            class="flex h-10 items-center gap-6 border-b border-border-default text-ui text-subtle-foreground border-t"
          >
            <span class="w-40">Name</span><span class="w-32">Type</span
            ><span class="flex-1">Shown as</span>
          </div>
          <div
            v-for="f in app.fields.filter((x) => x.on)"
            :key="f.id"
            class="flex min-h-14 items-center gap-6 border-b border-border-default py-3"
          >
            <code class="w-40 font-mono text-ui">{{ f.id }}</code>
            <span class="w-32 text-ui text-muted-foreground">{{ KIND_LABEL[f.kind] }}</span>
            <span class="flex-1 text-ui text-muted-foreground">{{ f.label }}</span>
          </div>
        </section>

        <section>
          <SectionHeader title="Example request">
            <template #controls>
              <SegmentedControl
                v-model="lang"
                size="sm"
                class="ml-auto"
                :options="[
                  { value: 'curl', label: 'cURL' },
                  { value: 'python', label: 'Python' },
                  { value: 'js', label: 'JavaScript' }
                ]"
              />
              <Button size="sm" variant="ghost" @click="toast('Copied the request')"
                ><Copy :size="12" />Copy</Button
              >
            </template>
          </SectionHeader>
          <pre
            class="overflow-x-auto rounded-control border border-border-default bg-black/30 p-4 font-mono text-ui leading-relaxed text-muted-foreground"
            >{{ code }}</pre
          >
        </section>
      </div>
    </div>
  </div>
</template>
