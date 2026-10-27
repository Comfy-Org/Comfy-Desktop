<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, Lock, Mail } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'
import Input from '../../ui/Input.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import MemberAvatar from '../MemberAvatar.vue'
import AppThemeFrame from './AppThemeFrame.vue'
import { toast } from '../../useProto'
import { tabApp, usd } from '../../appFlow'

/**
 * An app in its own tab, full screen: the page anyone with the link lands
 * on, in the app's theme. Opened with Open app you are signed in and run
 * it like any user. A `:visitor` tab is the same page for someone with no
 * account: they can look and fill in the form, and sign in only when they
 * press Run. Who pays is always under Run.
 */
const { tab } = defineProps<{ tab: string }>()
const app = computed(() => tabApp(tab).app)
const member = computed(() => !tabApp(tab).visitor)
const author = computed(() =>
  app.value?.owner === 'You' ? 'Pablo · Silverside' : (app.value?.owner ?? '')
)
const me = reactive({ signedIn: member.value, guest: false, credits: 0, used: 0 })
const panel = ref<InstanceType<typeof AppThemeFrame>>()
const sheet = ref<'' | 'signin' | 'credits'>('')
const topUp = ref('10')
const email = ref('')

const freeLeft = computed(() => Math.max(0, app.value!.freeRuns - me.used))
const sponsored = computed(() => app.value!.payer === 'you' && freeLeft.value > 0)
const payer = computed(() => {
  // You, signed in: the same rules as inside Desktop.
  if (member.value)
    return app.value!.group === 'shared'
      ? `About ${usd(app.value!.cost)} from your credits`
      : app.value!.team
        ? 'Paid by Silverside · team credits'
        : 'Paid by you'
  if (sponsored.value)
    return `Free · paid by Pablo · ${freeLeft.value} of ${app.value!.freeRuns} runs left`
  if (me.signedIn)
    return `About ${usd(app.value!.cost)} from your credits · ${usd(me.credits)} left`
  return `About ${usd(app.value!.cost)} a run, from your credits`
})

function gate(): boolean {
  if (member.value) return true
  if (!me.signedIn && !me.guest) {
    sheet.value = 'signin'
    return false
  }
  if (!sponsored.value && me.credits < app.value!.cost) {
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
  if (!sponsored.value && me.credits < app.value!.cost) {
    sheet.value = 'credits'
    return
  }
  setTimeout(() => panel.value?.run(), 250)
}
function done(): void {
  if (sponsored.value) me.used++
  else me.credits = Math.max(0, me.credits - app.value!.cost)
}
function reset(): void {
  Object.assign(me, { signedIn: member.value, guest: false, credits: 0, used: 0 })
}
watch(() => [app.value?.id, member.value], reset)
// You can always open your own and your team's apps; a visitor needs a link.
const shared = computed(
  () =>
    app.value!.state === 'live' &&
    (app.value!.link || (member.value && app.value!.group !== 'shared'))
)
</script>

<template>
  <div v-if="app" class="relative min-h-0 flex-1 overflow-y-auto bg-app-background">
    <!-- Not shared with this person -->
    <div v-if="!shared" class="mx-auto flex max-w-md flex-col items-center px-10 pt-40 text-center">
      <span
        class="inline-flex size-11 items-center justify-center rounded-full bg-secondary-background"
        ><Lock :size="17"
      /></span>
      <h1 class="mt-5 text-title font-semibold">This app is not shared with you</h1>
      <p class="mt-2 text-ui text-muted-foreground">
        {{ app.owner === 'You' ? 'Pablo' : app.owner }} shares {{ app.name }} with
        {{ app.team ? 'their team' : 'nobody yet' }}. Ask for access.
      </p>
      <Button class="mt-6" @click="toast('Your request is sent by email')">Request access</Button>
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
          ><MemberAvatar :name="member ? 'Pablo' : 'Sam Ortiz'" size="sm" />{{
            member ? 'pablo@silverside.studio' : 'sam@northwind.co'
          }}</span
        >
        <Button v-else variant="ghost" size="sm" @click="sheet = 'signin'">Sign in</Button>
      </template>
      <template #below>
        <p
          v-if="me.signedIn && !member"
          class="mt-6 flex items-center gap-1.5 text-ui text-subtle-foreground"
        >
          <Check :size="13" class="text-status-running" />Your results are saved to your account.
        </p>
        <p v-else-if="me.guest" class="mt-6 text-ui text-subtle-foreground">
          Results stay for 24 hours.
          <button type="button" class="underline underline-offset-2" @click="sheet = 'signin'">
            Sign in to keep them
          </button>
        </p>
      </template>
    </AppThemeFrame>

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
