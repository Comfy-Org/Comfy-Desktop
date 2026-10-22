<script setup lang="ts">
import { computed, ref } from 'vue'
import { MessageSquarePlus } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Badge from '../ui/Badge.vue'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import DialogContent from '../ui/DialogContent.vue'
import EmptyState from '../ui/EmptyState.vue'
import Input from '../ui/Input.vue'
import PageHeader from '../ui/PageHeader.vue'
import StatusDot from '../ui/StatusDot.vue'
import BrandButton from '../parts/space/BrandButton.vue'
import { clientUser, currentSpace, STUDIO } from '../spaces'
import { toast } from '../useProto'

/** Ask the studio for new tools; follow what they're building. */
const space = computed(() => currentSpace.value)
const open = ref(false)
const title = ref('')
const details = ref('')
const STATUS = {
  new: { label: 'Sent', dot: 'idle' },
  building: { label: 'Being built', dot: 'running' },
  shipped: { label: 'Shipped', dot: 'idle' }
} as const
function send(): void {
  if (!title.value.trim()) return
  space.value.requests.unshift({
    id: `req-${Date.now()}`,
    title: title.value.trim(),
    by: clientUser.value.name,
    when: 'Just now',
    status: 'new'
  })
  space.value.activity.unshift({
    who: clientUser.value.name,
    what: `requested ${title.value.trim()}`,
    when: 'Just now'
  })
  toast(`Sent to ${STUDIO.name}`)
  open.value = false
  title.value = ''
  details.value = ''
}
</script>

<template>
  <div class="mx-auto w-full max-w-280 px-10 pb-16">
    <PageHeader
      title="Requests"
      :description="`Ask ${STUDIO.name} for a new tool or a change to one.`"
    >
      <template #actions
        ><BrandButton size="lg" @click="open = true"
          ><MessageSquarePlus :size="15" />Request a tool</BrandButton
        ></template
      >
    </PageHeader>
    <Card v-if="space.requests.length" class="divide-y divide-border-default">
      <div v-for="r in space.requests" :key="r.id" class="flex items-center gap-4 px-5 py-4">
        <div class="min-w-0 flex-1">
          <p class="truncate text-ui font-medium">{{ r.title }}</p>
          <p class="mt-0.5 text-ui text-subtle-foreground">
            {{ r.by }} · {{ r.when }}<template v-if="r.note"> · {{ r.note }}</template>
          </p>
        </div>
        <Badge size="md"
          ><StatusDot :status="STATUS[r.status].dot" />{{ STATUS[r.status].label }}</Badge
        >
      </div>
    </Card>
    <EmptyState
      v-else
      :icon="MessageSquarePlus"
      title="No requests yet"
      :description="`Tell ${STUDIO.name} what you need and follow it here.`"
    />

    <DialogRoot v-model:open="open">
      <DialogContent size="md" class="p-5">
        <DialogTitle class="text-heading font-semibold">Request a tool</DialogTitle>
        <DialogDescription class="mt-1 text-ui text-muted-foreground">
          {{ STUDIO.name }} gets this and replies here.
        </DialogDescription>
        <div class="mt-5 flex flex-col gap-3">
          <Input v-model="title" placeholder="What do you need?" aria-label="Title" />
          <textarea
            v-model="details"
            rows="4"
            placeholder="What goes in, what should come out, any examples…"
            class="resize-none rounded-control border border-border-default bg-secondary-background px-3 py-2 text-ui outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
          />
          <Button variant="secondary" class="self-start" @click="toast('Attach examples')"
            >Attach examples</Button
          >
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <Button variant="ghost" @click="open = false">Cancel</Button>
          <Button variant="primary" :disabled="!title.trim()" @click="send">Send request</Button>
        </div>
      </DialogContent>
    </DialogRoot>
  </div>
</template>
