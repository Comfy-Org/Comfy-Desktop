<script setup lang="ts">
import { ref } from 'vue'
import { Lock, UserPlus } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Input from '../../ui/Input.vue'
import Select from '../../ui/Select.vue'
import MemberAvatar from '../../parts/MemberAvatar.vue'
import { toast } from '../../useProto'
import { MEMBERS } from '../../mock'

const invite = ref('')
const roles = ref<Record<string, string>>(Object.fromEntries(MEMBERS.map((m) => [m.id, m.role])))
const access = ref<'restricted' | 'workspace'>('restricted')
const roleOptions = [
  { value: 'collaborator', label: 'Collaborator' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'remove', label: 'Remove' }
]
function send(): void {
  if (!invite.value.trim()) return
  toast(`Invited ${invite.value.trim()}`)
  invite.value = ''
}
</script>

<template>
  <form class="mt-5 flex gap-2" @submit.prevent="send">
    <Input
      v-model="invite"
      size="lg"
      class="flex-1"
      placeholder="Add people by name or email"
      aria-label="Add people"
    >
      <template #leading><UserPlus :size="15" class="text-subtle-foreground" /></template>
    </Input>
    <Button variant="primary" size="lg" type="submit" :disabled="!invite.trim()">Invite</Button>
  </form>

  <Card class="mt-4 overflow-hidden">
    <div
      v-for="m in MEMBERS"
      :key="m.id"
      class="flex min-h-16 items-center gap-3.5 border-b border-border-default px-4 last:border-b-0"
    >
      <MemberAvatar :name="m.name" size="lg" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-ui font-medium">
          {{ m.name }} <span v-if="m.you" class="font-normal text-subtle-foreground">(You)</span>
        </p>
        <p class="truncate text-ui text-subtle-foreground">{{ m.email }}</p>
      </div>
      <Badge v-if="m.role === 'owner'" size="tag">Owner</Badge>
      <Select v-else v-model="roles[m.id]!" variant="ghost" :options="roleOptions" />
    </div>
  </Card>

  <h3 class="mt-7 mb-3 text-ui font-semibold tracking-wider text-subtle-foreground uppercase">
    General access
  </h3>
  <Card class="flex items-center gap-3.5 px-4 py-3.5">
    <Lock :size="18" class="shrink-0 text-subtle-foreground" />
    <div class="min-w-0 flex-1">
      <p class="text-ui font-medium">
        {{ access === 'restricted' ? 'Only invited people' : 'Everyone in the workspace' }}
      </p>
      <p class="text-ui text-muted-foreground">
        {{
          access === 'restricted'
            ? 'Only the people listed above can see this project.'
            : 'Anyone in Design Team can find and open it.'
        }}
      </p>
    </div>
    <Select
      v-model="access"
      variant="ghost"
      :options="[
        { value: 'restricted', label: 'Restricted' },
        { value: 'workspace', label: 'Workspace' }
      ]"
    />
  </Card>
  <p class="mt-5 text-ui text-subtle-foreground">
    Workflows and apps in this project can also be shared or published one by one.
  </p>
</template>
