<script setup lang="ts">
import { computed } from 'vue'
import { Cloud } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Avatar from '../ui/Avatar.vue'
import Button from '../ui/Button.vue'
import DialogContent from '../ui/DialogContent.vue'
import { hostActions, proto } from '../useProto'

const open = computed({
  get: () => Boolean(proto.loginPrompt),
  set: (v) => {
    if (!v) proto.loginPrompt = null
  }
})
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent size="sm" class="items-center px-6 pt-7 pb-4.5 text-center">
      <Avatar size="xl" class="mb-3"><Cloud :size="18" /></Avatar>
      <DialogTitle class="text-heading font-semibold">{{ proto.loginPrompt?.title }}</DialogTitle>
      <DialogDescription class="mt-2 mb-4.5 leading-relaxed text-muted-foreground">
        {{ proto.loginPrompt?.body }}
      </DialogDescription>
      <Button variant="primary" @click="hostActions.signIn()">Log in</Button>
      <Button variant="link" size="sm" class="mt-3" @click="open = false">Not now</Button>
    </DialogContent>
  </DialogRoot>
</template>
