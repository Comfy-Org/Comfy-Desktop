<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, ChevronDown, Eye, Link2Off, Lock, Mail, X } from 'lucide-vue-next'
import {
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import Input from '../../ui/Input.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import MemberAvatar from '../MemberAvatar.vue'
import AppThemeFrame from './AppThemeFrame.vue'
import { toast } from '../../useProto'
import {
  appsProto,
  exitPreview,
  libApp,
  previewAs,
  previewLabel,
  PREVIEWS,
  usd,
  type PreviewAs
} from '../../appFlow'

/**
 * An app in its own tab, full screen: its URL, in its theme. There is one
 * page for everyone; who you are and the app's share settings decide what
 * it shows:
 *   can run        - Run works; the line under it says who pays
 *   sign in to run - anyone with the link can look and fill in the form,
 *                    and signs in only when they press Run
 *   no access      - Request access, or switch account
 *   link gone      - revoked, expired or over its cap
 * The creator checks this with "Preview as" (a thin bar on top says so).
 */
const { id } = defineProps<{ id: string }>()
const app = computed(() => libApp(id)!)
const as = computed<PreviewAs | undefined>(() => appsProto.preview[id])
const owner = computed(() => (app.value.owner === 'You' ? 'Pablo' : app.value.owner))
const author = computed(() => (app.value.owner === 'You' ? 'Pablo · Silverside' : app.value.owner))

/** Who is looking, and what the share settings let them do. */
const VIEWERS = {
  you: { name: 'Pablo', email: 'pablo@silverside.studio' },
  teammate: { name: 'Jane Park', email: 'jane@silverside.studio' },
  outsider: { name: 'Sam Ortiz', email: 'sam@gmail.com' },
  link: { name: 'Sam Ortiz', email: 'sam@northwind.co' }
}
const viewer = computed(() =>
  as.value === 'teammate'
    ? VIEWERS.teammate
    : as.value === 'outsider'
      ? VIEWERS.outsider
      : as.value === 'link'
        ? VIEWERS.link
        : VIEWERS.you
)
type Access = 'run' | 'signin' | 'none' | 'gone'
const access = computed<Access>(() => {
  const a = app.value
  if (as.value === 'expired') return 'gone'
  if (!as.value) return 'run'
  if (as.value === 'teammate') return a.team || a.link ? 'run' : 'none'
  if (as.value === 'outsider') return a.link ? 'run' : 'none'
  return a.link ? 'signin' : 'none'
})
/** Inside the team: team credits pay. Outside: free runs, then their own. */
const inTeam = computed(() => !as.value || (as.value === 'teammate' && app.value.team))

const me = reactive({ signedIn: true, guest: false, credits: 0, used: 0 })
function reset(): void {
  Object.assign(me, { signedIn: as.value !== 'link', guest: false, credits: 0, used: 0 })
}
reset()
watch(() => [id, as.value], reset)

const panel = ref<InstanceType<typeof AppThemeFrame>>()
const sheet = ref<'' | 'signin' | 'credits'>('')
const topUp = ref('10')
const email = ref('')
const freeLeft = computed(() => Math.max(0, app.value.freeRuns - me.used))
const sponsored = computed(() => !inTeam.value && app.value.payer === 'you' && freeLeft.value > 0)
const payer = computed(() => {
  const a = app.value
  if (!as.value)
    return a.group === 'shared'
      ? `About ${usd(a.cost)} from your credits`
      : a.team || a.group === 'team'
        ? 'Paid by Silverside · team credits'
        : 'Paid by you'
  if (inTeam.value) return 'Paid by Silverside · team credits'
  if (sponsored.value) return `Free · paid by Pablo · ${freeLeft.value} of ${a.freeRuns} runs left`
  if (me.signedIn) return `About ${usd(a.cost)} from your credits · ${usd(me.credits)} left`
  return `About ${usd(a.cost)} a run, from your credits`
})

function gate(): boolean {
  if (inTeam.value) return true
  if (!me.signedIn && !me.guest) {
    sheet.value = 'signin'
    return false
  }
  if (!sponsored.value && me.credits < app.value.cost) {
    sheet.value = 'credits'
    return false
  }
  return true
}
function signIn(how: string): void {
  me.signedIn = true
  toast(`Signed in with ${how}. Your inputs are still here.`)
  continueRun()
}
function guest(): void {
  me.guest = true
  continueRun()
}
function addCredits(): void {
  me.credits += Number(topUp.value)
  continueRun()
}
// After sign-in, the run starts by itself: no second click on Run.
function continueRun(): void {
  sheet.value = ''
  if (!sponsored.value && me.credits < app.value.cost) {
    sheet.value = 'credits'
    return
  }
  setTimeout(() => panel.value?.run(), 250)
}
function done(): void {
  if (inTeam.value) return
  if (sponsored.value) me.used++
  else me.credits = Math.max(0, me.credits - app.value.cost)
}
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col bg-app-background">
    <!-- Preview as: the one bit of chrome, so the creator knows -->
    <div
      v-if="as"
      class="flex h-9 shrink-0 items-center gap-2 border-b border-border-default bg-secondary-background px-4 text-ui"
    >
      <Eye :size="13" class="text-muted-foreground" />
      <span class="text-muted-foreground">Previewing as</span>
      <DropdownMenuRoot :modal="false">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-min font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {{ previewLabel(as) }}<ChevronDown :size="12" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-72">
          <DropdownMenuItem v-for="p in PREVIEWS" :key="p.id" @select="previewAs(id, p.id)">
            <Check :size="13" :class="p.id === as ? '' : 'opacity-0'" />
            <span class="min-w-0">
              <span class="block">{{ p.label }}</span>
              <span class="block text-subtle-foreground">{{ p.hint }}</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuRoot>
      <span class="flex-1" />
      <Button variant="ghost" size="sm" @click="exitPreview(id)"
        ><X :size="12" />Exit preview</Button
      >
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- No access, or the link is gone -->
      <div
        v-if="access === 'none' || access === 'gone'"
        class="mx-auto flex max-w-md flex-col items-center px-10 pt-40 text-center"
      >
        <span
          class="inline-flex size-11 items-center justify-center rounded-full bg-secondary-background"
        >
          <Link2Off v-if="access === 'gone'" :size="17" /><Lock v-else :size="17" />
        </span>
        <template v-if="access === 'gone'">
          <h1 class="mt-5 text-title font-semibold">This link no longer works</h1>
          <p class="mt-2 text-ui text-muted-foreground">
            {{ owner }} turned it off, or it reached its limit. Your past results are still in your
            account.
          </p>
          <Button class="mt-6" @click="toast(`${owner} gets your request by email`)"
            >Ask for a new link</Button
          >
        </template>
        <!-- Signed out, and the link isn't open to anyone -->
        <template v-else-if="as === 'link'">
          <h1 class="mt-5 text-title font-semibold">Sign in to open {{ app.name }}</h1>
          <p class="mt-2 text-ui text-muted-foreground">
            It is shared with {{ app.team ? 'the Silverside team' : 'invited people' }}. Use the
            account it was shared with.
          </p>
          <Button variant="primary" class="mt-6" @click="toast('Sign in')">Sign in</Button>
        </template>
        <template v-else>
          <h1 class="mt-5 text-title font-semibold">You need access</h1>
          <p class="mt-2 text-ui text-muted-foreground">
            {{ app.name }} is shared with {{ app.team ? 'the Silverside team' : 'invited people' }}.
            You are signed in as {{ viewer.email }}.
          </p>
          <div class="mt-6 flex gap-2">
            <Button variant="primary" @click="toast(`${owner} gets your request by email`)"
              >Request access</Button
            >
            <Button variant="ghost" @click="toast('Switch account')">Switch account</Button>
          </div>
        </template>
      </div>

      <AppThemeFrame
        v-else
        ref="panel"
        class="min-h-full"
        :name="app.name"
        :blurb="app.blurb"
        :author
        :thumb-id="app.thumbId"
        :fields="app.fields"
        :cost="app.cost"
        :payer
        :layout="app.layout"
        :theme="app.theme"
        :gate
        @done="done"
      >
        <template #account>
          <span v-if="me.signedIn" class="flex items-center gap-2 text-ui text-muted-foreground"
            ><MemberAvatar :name="viewer.name" size="sm" />{{ viewer.email }}</span
          >
          <Button v-else variant="ghost" size="sm" @click="sheet = 'signin'">Sign in</Button>
        </template>
        <template #below>
          <p v-if="me.guest" class="mt-6 text-ui text-subtle-foreground">
            Results stay for 24 hours.
            <button type="button" class="underline underline-offset-2" @click="sheet = 'signin'">
              Sign in to keep them
            </button>
          </p>
        </template>
      </AppThemeFrame>
    </div>

    <!-- Sign in at Run -->
    <DialogRoot :open="!!sheet" @update:open="(v: boolean) => !v && (sheet = '')">
      <DialogContent size="sm" class="p-6">
        <template v-if="sheet === 'signin'">
          <DialogTitle class="text-heading font-semibold">Sign in to run</DialogTitle>
          <DialogDescription class="mt-1 text-ui text-muted-foreground">
            Your inputs stay. The run starts right after.
            {{ sponsored ? `Pablo pays for your first ${app.freeRuns} runs.` : '' }}
          </DialogDescription>
          <div class="mt-6 flex flex-col gap-2">
            <Button size="lg" block @click="signIn('Google')">Continue with Google</Button>
            <Button size="lg" block @click="signIn('Apple')">Continue with Apple</Button>
            <form class="mt-2 flex gap-2" @submit.prevent="signIn('an email code')">
              <Input v-model="email" placeholder="you@company.com" class="flex-1" />
              <Button type="submit"><Mail :size="13" />Send code</Button>
            </form>
          </div>
          <template v-if="app.noAccount && sponsored">
            <div class="my-5 h-px bg-border-default" />
            <Button variant="ghost" block @click="guest">Run without an account</Button>
            <p class="mt-1 text-center text-ui text-subtle-foreground">
              Results stay for 24 hours.
            </p>
          </template>
        </template>

        <template v-else-if="sheet === 'credits'">
          <DialogTitle class="text-heading font-semibold">Add credits to run</DialogTitle>
          <DialogDescription class="mt-1 text-ui text-muted-foreground">
            Each run of {{ app.name }} costs about {{ usd(app.cost) }}. You pay what it costs, no
            markup.
          </DialogDescription>
          <SegmentedControl
            v-model="topUp"
            variant="contained"
            class="mt-6"
            :options="[
              { value: '5', label: '$5' },
              { value: '10', label: '$10' },
              { value: '20', label: '$20' }
            ]"
          />
          <p class="mt-3 text-ui text-subtle-foreground">
            About {{ Math.floor(Number(topUp) / app.cost) }} runs.
          </p>
          <Button variant="primary" size="lg" block class="mt-6" @click="addCredits"
            >Add ${{ topUp }} and run</Button
          >
        </template>
      </DialogContent>
    </DialogRoot>
  </div>
</template>
