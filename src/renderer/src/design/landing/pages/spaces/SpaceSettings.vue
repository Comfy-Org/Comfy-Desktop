<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Input from '../../ui/Input.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import SettingsSection from '../../ui/SettingsSection.vue'
import StatusDot from '../../ui/StatusDot.vue'
import SpacePolicies from './SpacePolicies.vue'
import { spaceById } from '../../spaces'
import { go, toast } from '../../useProto'

/** Name, domain, policies, API access, and the dangerous stuff. */
const { spaceId } = defineProps<{ spaceId: string }>()
const space = computed(() => spaceById(spaceId)!)

// Domain: a comfy.app subdomain is always there; a custom domain is optional.
const own = !space.value.domain.endsWith('.comfy.app')
const sub = ref(own ? space.value.id : space.value.domain.replace('.comfy.app', ''))
const custom = ref(own ? space.value.domain : '')
const verified = ref(own)
function useCustom(): void {
  if (!custom.value.includes('.')) return
  space.value.domain = custom.value
  toast('Waiting for the DNS record…')
  setTimeout(() => (verified.value = true), 1200)
}
</script>

<template>
  <div class="divide-y divide-border-default">
    <SettingsSection title="General">
      <SettingsRow label="Name"><Input v-model="space.name" /></SettingsRow>
    </SettingsSection>

    <SettingsSection
      title="Domain"
      description="Where members open the space. Use your own domain to make it fully yours."
    >
      <SettingsRow label="Comfy address" hint="Always works, even with a custom domain.">
        <Input v-model="sub" mono
          ><template #trailing
            ><span class="text-ui text-subtle-foreground">.comfy.app</span></template
          ></Input
        >
      </SettingsRow>
      <SettingsRow label="Custom domain">
        <div class="flex gap-2">
          <Input v-model="custom" mono placeholder="create.yourbrand.com" class="flex-1" />
          <Button @click="useCustom">Connect</Button>
        </div>
      </SettingsRow>
      <div v-if="custom" class="flex flex-col gap-2 px-5 py-4">
        <div class="flex items-center gap-2">
          <span class="flex-1 text-ui font-medium">DNS record</span>
          <Badge size="md"
            ><StatusDot :status="verified ? 'running' : 'idle'" />{{
              verified ? 'Verified · SSL on' : 'Not found yet'
            }}</Badge
          >
        </div>
        <div
          class="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-3 rounded-control bg-black/20 px-3 py-2 font-mono text-ui"
        >
          <span class="text-subtle-foreground">CNAME</span>
          <span class="truncate">{{ custom.split('.')[0] }}</span>
          <span class="truncate">spaces.comfy.app</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Copy"
            @click="toast('Copied spaces.comfy.app')"
            ><Copy :size="12"
          /></Button>
        </div>
        <p class="text-ui text-subtle-foreground">
          Add this at your DNS provider. Certificates renew automatically.
        </p>
      </div>
      <SettingsRow label="Email sender" hint="Invites and notifications come from this name.">
        <Input v-model="space.brand.logo.name" />
      </SettingsRow>
    </SettingsSection>
  </div>

  <SpacePolicies :space-id="spaceId" class="border-t border-border-default" />

  <div class="divide-y divide-border-default border-t border-border-default">
    <SettingsSection title="API access" description="Call this space's tools from other systems.">
      <SettingsRow
        label="Space API key"
        hint="Scoped to this space's tools and budget."
        layout="inline"
      >
        <Button size="sm" @click="toast('Created a key for this space')">Create key</Button>
      </SettingsRow>
      <SettingsRow label="Webhook" hint="Called when a run finishes or is approved.">
        <Input placeholder="https://example.com/hooks/comfy" mono />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection title="Danger zone" tone="danger">
      <SettingsRow
        label="Pause space"
        hint="People can sign in and download, but not run."
        layout="inline"
      >
        <Button
          size="sm"
          @click="
            ((space.status = space.status === 'paused' ? 'live' : 'paused'),
            toast(`${space.name} ${space.status}`))
          "
          >{{ space.status === 'paused' ? 'Resume' : 'Pause' }}</Button
        >
      </SettingsRow>
      <SettingsRow
        label="Delete space"
        hint="Deletes its people, outputs and history. Can't be undone."
        layout="inline"
      >
        <Button
          variant="destructive"
          size="sm"
          @click="(toast('Type the space name to delete'), go('spaces'))"
          >Delete</Button
        >
      </SettingsRow>
    </SettingsSection>
  </div>
</template>
