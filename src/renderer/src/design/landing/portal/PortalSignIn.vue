<script setup lang="ts">
import { computed, ref } from 'vue'
import { KeyRound, Mail } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import Input from '../ui/Input.vue'
import SpaceMark from '../parts/space/SpaceMark.vue'
import ComfyCLogo from '../../../components/icons/ComfyCLogo.vue'
import { clientUser, currentSpace, STUDIO } from '../spaces'
import { proto, toast } from '../useProto'

/**
 * Step 2: sign in on the space's own page. It's a Comfy account under the
 * hood - one account for every space - but branded as the space.
 */
const space = computed(() => currentSpace.value)
const email = ref(clientUser.value.email)
const sent = ref(false)
function enter(how: string): void {
  toast(`Signed in with ${how}`)
  proto.memberStage = 'space'
  proto.portalPage = 'home'
}
const payNote = computed(() =>
  space.value.payer === 'members'
    ? 'Runs here use your Comfy credits. New accounts start with 400 free.'
    : space.value.payer === 'split'
      ? `${space.value.name} covers ${space.value.allowance.toLocaleString('en-US')} credits a month for you, then runs use your own.`
      : `Runs are covered by ${space.value.name}.`
)
</script>

<template>
  <div class="flex min-h-full items-center justify-center px-6 py-14">
    <Card class="w-full max-w-sm p-7">
      <div class="flex flex-col items-center text-center">
        <span
          class="inline-flex size-12 items-center justify-center rounded-card bg-secondary-background-hover"
          ><ComfyCLogo :size="26"
        /></span>
        <h1 class="mt-5 text-title font-semibold">Log in to Comfy</h1>
        <p class="mt-1 text-ui text-muted-foreground">to join the {{ space.name }} Space</p>
        <div
          class="mt-4 flex items-center gap-2 rounded-full border border-border-default py-1 pr-3 pl-1"
        >
          <SpaceMark :brand="space.brand" size="xs" />
          <span class="text-ui">{{ space.name }} Space · by {{ STUDIO.name }}</span>
        </div>
      </div>

      <div class="mt-6 flex flex-col gap-2">
        <Button
          v-if="space.policies.sso"
          variant="primary"
          size="lg"
          block
          @click="enter('single sign-on')"
          ><KeyRound :size="14" />Continue with {{ space.brand.logo.name }} SSO</Button
        >
        <template v-else>
          <Button size="lg" block @click="enter('Google')">Continue with Google</Button>
          <Button size="lg" block @click="enter('Microsoft')">Continue with Microsoft</Button>
        </template>
      </div>

      <div
        v-if="!space.policies.sso"
        class="my-5 flex items-center gap-3 text-ui text-subtle-foreground"
      >
        <span class="h-px flex-1 bg-border-default" />or<span
          class="h-px flex-1 bg-border-default"
        />
      </div>
      <div v-if="!space.policies.sso" class="flex flex-col gap-2">
        <Input v-model="email" aria-label="Email" />
        <Button
          v-if="!sent"
          variant="secondary"
          block
          @click="((sent = true), toast('Check your email'))"
          ><Mail :size="14" />Email me a sign-in link</Button
        >
        <Button v-else variant="link" block @click="enter('email link')"
          >I clicked the link in my email</Button
        >
      </div>

      <p class="mt-6 text-center text-ui text-subtle-foreground">
        Uses your Comfy account - one account for every space you're in. New here? We'll create it.
      </p>
      <p class="mt-2 text-center text-ui text-subtle-foreground">{{ payNote }}</p>
    </Card>
  </div>
</template>
