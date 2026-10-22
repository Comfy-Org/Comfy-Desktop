<script setup lang="ts">
import { computed, ref } from 'vue'
import { UserPlus } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import DialogContent from '../../ui/DialogContent.vue'
import Input from '../../ui/Input.vue'
import Select from '../../ui/Select.vue'
import MemberAvatar from '../MemberAvatar.vue'
import { ROLE_LABEL, spaceById, type SpaceRole } from '../../spaces'
import { toast } from '../../useProto'

/** People in one space. Managed by the studio and by the space's own
 *  admins; nobody here can see any other space. */
const { spaceId } = defineProps<{ spaceId: string }>()
const space = computed(() => spaceById(spaceId)!)
const ROLES = (Object.keys(ROLE_LABEL) as SpaceRole[]).map((r) => ({
  value: r,
  label: ROLE_LABEL[r]
}))

const open = ref(false)
const emails = ref('')
const role = ref<SpaceRole>('member')
function invite(): void {
  const list = emails.value.split(/[\s,]+/).filter((e) => e.includes('@'))
  if (!list.length) return
  for (const email of list) {
    space.value.members.push({
      name: email.split('@')[0]!,
      email,
      role: role.value,
      lastActive: 'Invited',
      runs: 0
    })
  }
  toast(`Invited ${list.length} to ${space.value.name}`)
  open.value = false
  emails.value = ''
}
defineExpose({ invite: () => (open.value = true) })
</script>

<template>
  <Card class="overflow-hidden">
    <div
      class="grid h-10 grid-cols-[minmax(0,1fr)_160px_120px_80px] items-center gap-4 border-b border-border-default px-5 text-ui text-subtle-foreground"
    >
      <span>{{ space.members.length }} people</span><span>Role</span><span>Last active</span
      ><span class="text-right">Runs</span>
    </div>
    <div
      v-for="m in space.members"
      :key="m.email"
      class="grid min-h-14 grid-cols-[minmax(0,1fr)_160px_120px_80px] items-center gap-4 border-b border-border-default px-5 last:border-b-0"
    >
      <span class="flex min-w-0 items-center gap-3">
        <MemberAvatar :name="m.name" />
        <span class="min-w-0">
          <span class="block truncate text-ui font-medium">{{ m.name }}</span>
          <span class="block truncate text-ui text-subtle-foreground">{{ m.email }}</span>
        </span>
      </span>
      <Select v-model="m.role" variant="ghost" size="sm" :options="ROLES" />
      <span class="text-ui text-muted-foreground">{{ m.lastActive }}</span>
      <span class="text-right text-ui text-muted-foreground tabular-nums">{{ m.runs }}</span>
    </div>
    <div v-if="!space.members.length" class="px-5 py-8 text-center text-ui text-subtle-foreground">
      No one yet. Invite people to get started.
    </div>
  </Card>

  <DialogRoot v-model:open="open">
    <DialogContent size="md" class="p-5">
      <DialogTitle class="flex items-center gap-2 text-heading font-semibold"
        ><UserPlus :size="16" />Invite to {{ space.name }}</DialogTitle
      >
      <DialogDescription class="mt-1 text-ui text-muted-foreground">
        They only see this space - never your workspace or other spaces.
      </DialogDescription>
      <div class="mt-5 flex flex-col gap-3">
        <Input
          v-model="emails"
          placeholder="name@company.com, another@company.com"
          aria-label="Emails"
        />
        <Select v-model="role" label="Role" :options="ROLES" />
        <p class="text-ui text-subtle-foreground">
          Space admin: manage the team and see usage. Member: run tools. Viewer: browse and review
          outputs.
        </p>
      </div>
      <div class="mt-6 flex justify-end gap-2">
        <Button variant="ghost" @click="open = false">Cancel</Button>
        <Button variant="primary" @click="invite">Send invites</Button>
      </div>
    </DialogContent>
  </DialogRoot>
</template>
