<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Copy, Link2, Lock, Users, X } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'
import Input from '../../ui/Input.vue'
import NumberField from '../../ui/NumberField.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import Select from '../../ui/Select.vue'
import Switch from '../../ui/Switch.vue'
import { cn } from '../../ui/cn'
import MemberAvatar from '../MemberAvatar.vue'
import PreviewAsMenu from './PreviewAsMenu.vue'
import { thumb } from '../../mock'
import { toast } from '../../useProto'
import { copyLink, dialogs, libApp, usd, type Person } from '../../appFlow'

/**
 * Share an app, like a Google Doc: people, general access, and who pays
 * when people outside the team run it. Access to an app is not a seat in
 * the workspace.
 */
const open = computed({
  get: () => !!dialogs.share,
  set: (v) => {
    if (!v) dialogs.share = ''
  }
})
const app = computed(() => libApp(dialogs.share))
const email = ref('')

function invite(): void {
  const e = email.value.trim()
  if (!app.value || !/.+@.+\..+/.test(e)) return toast('Type an email address')
  app.value.people.push({ name: e, email: e, role: 'Can run' })
  email.value = ''
  toast(`Invite sent to ${e}. The email signs them in.`)
}
function remove(p: Person): void {
  if (!app.value) return
  app.value.people = app.value.people.filter((x) => x !== p)
}
const general = computed({
  get: () => (app.value?.link ? 'link' : 'restricted'),
  set: (v: string) => {
    if (app.value) app.value.link = v === 'link'
  }
})
const outside = computed(() => !!app.value && (app.value.link || app.value.people.length > 0))
const ROLES = [
  { value: 'Can run', label: 'Can run' },
  { value: 'Can edit', label: 'Can edit' }
]
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent v-if="app" size="lg" class="max-w-[520px] p-0">
      <div class="flex items-center gap-3 px-6 pt-6">
        <img
          :src="thumb(app.thumbId)"
          alt=""
          class="size-10 rounded-control border border-border-default object-cover"
        />
        <div class="min-w-0">
          <DialogTitle class="text-heading font-semibold">Share {{ app.name }}</DialogTitle>
          <DialogDescription class="text-ui text-muted-foreground"
            >People get access, not a copy. You can revoke it at any time.</DialogDescription
          >
        </div>
      </div>

      <div class="flex max-h-[62vh] flex-col gap-6 overflow-y-auto px-6 py-5">
        <!-- Invite -->
        <form class="flex gap-2" @submit.prevent="invite">
          <Input v-model="email" placeholder="Add people by email" class="flex-1" />
          <Button type="submit">Invite</Button>
        </form>

        <!-- People with access -->
        <div class="flex flex-col gap-1">
          <p class="mb-1 text-ui font-medium">People with access</p>
          <div class="flex h-10 items-center gap-3">
            <MemberAvatar name="Pablo" size="sm" />
            <span class="flex-1 text-ui">Pablo (you)</span>
            <span class="pr-2 text-ui text-subtle-foreground">Owner</span>
          </div>
          <div class="flex h-10 items-center gap-3">
            <span
              class="inline-flex size-6 items-center justify-center rounded-full bg-secondary-background"
              ><Users :size="12"
            /></span>
            <span class="min-w-0 flex-1">
              <span class="block text-ui">Silverside team</span>
              <span class="block text-ui text-subtle-foreground">8 people · team credits pay</span>
            </span>
            <Switch v-model="app.team" aria-label="Share with the team" />
          </div>
          <div v-for="p in app.people" :key="p.email" class="flex h-10 items-center gap-3">
            <MemberAvatar :name="p.name" size="sm" />
            <span class="min-w-0 flex-1 truncate text-ui">{{ p.email }}</span>
            <Select
              :model-value="p.role"
              :options="ROLES"
              variant="ghost"
              size="sm"
              class="w-28"
              @update:model-value="(v: string) => (p.role = v as Person['role'])"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="`Revoke ${p.email}`"
              @click="remove(p)"
              ><X :size="13"
            /></Button>
          </div>
        </div>

        <!-- General access -->
        <div class="flex flex-col gap-2">
          <p class="text-ui font-medium">General access</p>
          <div class="flex items-center gap-3">
            <span
              class="inline-flex size-8 items-center justify-center rounded-control bg-secondary-background"
            >
              <Link2 v-if="app.link" :size="14" /><Lock v-else :size="14" />
            </span>
            <span class="min-w-0 flex-1 text-ui text-muted-foreground">{{
              app.link
                ? 'Anyone with the link can run it. They sign in when they press Run.'
                : 'Only the people above can open it.'
            }}</span>
          </div>
          <SegmentedControl
            v-model="general"
            variant="contained"
            size="sm"
            class="self-start"
            :options="[
              { value: 'restricted', label: 'Only people above' },
              { value: 'link', label: 'Anyone with the link' }
            ]"
          />
        </div>

        <!-- Who pays -->
        <div v-if="outside" class="flex flex-col gap-2">
          <p class="text-ui font-medium">Who pays when people outside the team run it</p>
          <div class="flex flex-col rounded-card border border-border-default p-1">
            <button
              v-for="o in [
                {
                  value: 'each' as const,
                  label: 'Each person',
                  hint: `From their own credits · about ${usd(app.cost)} a run`
                },
                {
                  value: 'you' as const,
                  label: 'You',
                  hint: 'Free runs for each person, up to a cap'
                }
              ]"
              :key="o.value"
              type="button"
              :class="
                cn(
                  'flex items-center gap-3 rounded-control px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                  app.payer === o.value
                    ? 'bg-secondary-background-hover'
                    : 'hover:bg-secondary-background'
                )
              "
              @click="app.payer = o.value"
            >
              <span class="min-w-0 flex-1">
                <span class="block text-ui font-medium">{{ o.label }}</span>
                <span class="block text-ui text-subtle-foreground">{{ o.hint }}</span>
              </span>
              <Check v-if="app.payer === o.value" :size="15" />
            </button>
          </div>
          <div
            v-if="app.payer === 'you'"
            class="flex flex-col gap-3 rounded-card border border-border-default px-4 py-3"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-ui text-muted-foreground">Free runs per person</span>
              <NumberField v-model="app.freeRuns" :min="1" :max="50" class="w-28" />
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ui text-muted-foreground"
                >Stop at · {{ usd(app.spent) }} spent so far</span
              >
              <NumberField v-model="app.cap" :min="1" :max="1000" unit="$" class="w-28" />
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="min-w-0">
                <span class="block text-ui text-muted-foreground"
                  >Allow runs without an account</span
                >
                <span class="block text-ui text-subtle-foreground"
                  >Results stay for 24 hours. Off for most apps.</span
                >
              </span>
              <Switch v-model="app.noAccount" aria-label="Allow runs without an account" />
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between border-t border-border-default px-6 py-4">
        <span class="flex items-center gap-1">
          <Button variant="ghost" @click="copyLink(app)"><Copy :size="13" />Copy link</Button>
          <PreviewAsMenu :app-id="app.id" @pick="dialogs.share = ''" />
        </span>
        <Button variant="primary" @click="dialogs.share = ''">Done</Button>
      </div>
    </DialogContent>
  </DialogRoot>
</template>
