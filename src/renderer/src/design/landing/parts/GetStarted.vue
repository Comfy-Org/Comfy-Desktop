<script setup lang="ts">
import { Cloud, Laptop } from 'lucide-vue-next'
import Avatar from '../ui/Avatar.vue'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import { hostActions, proto } from '../useProto'
import { INSTANCES } from '../mock'
import { shownName } from '../account'

/** Shown while there is no local instance: the two places ComfyUI can run.
 *  `hero` makes it the page headline. */
const { hero = false } = defineProps<{ hero?: boolean }>()
const options = [
  {
    key: 'cloud',
    icon: Cloud,
    title: 'Comfy Cloud',
    body: 'Every model ready on fast GPUs. Nothing to install.'
  },
  {
    key: 'local',
    icon: Laptop,
    title: 'This computer',
    body: 'Runs on your GPU, works offline. About 15 GB.'
  }
] as const
</script>

<template>
  <section :class="['text-center', hero && 'pt-14']">
    <h2
      :class="[
        'heading-gradient font-bold tracking-[-0.02em]',
        hero ? 'text-display' : 'text-[30px] leading-9'
      ]"
    >
      {{
        hero
          ? proto.signedIn
            ? `Hi ${shownName || 'there'}. Let's create`
            : 'Welcome to Comfy'
          : 'Where should ComfyUI run?'
      }}
    </h2>
    <p class="mt-2 text-ui text-muted-foreground">
      Pick where ComfyUI runs. You can add the other later.
    </p>

    <div class="mx-auto mt-7 grid max-w-180 grid-cols-2 gap-4">
      <Card
        v-for="o in options"
        :key="o.key"
        variant="glass"
        padding="lg"
        class="flex flex-col items-center"
      >
        <Avatar size="lg"><component :is="o.icon" :size="18" /></Avatar>
        <h3 class="mt-3 mb-1 text-heading font-semibold">{{ o.title }}</h3>
        <p class="mb-4 max-w-56 text-ui leading-normal text-muted-foreground">{{ o.body }}</p>
        <template v-if="o.key === 'cloud'">
          <Button
            v-if="proto.signedIn"
            variant="primary"
            class="mt-auto"
            @click="hostActions.launch(INSTANCES[0]!)"
          >
            Open Comfy Cloud
          </Button>
          <Button v-else variant="primary" class="mt-auto" @click="hostActions.signIn()"
            >Log in</Button
          >
        </template>
        <Button v-else class="mt-auto" @click="hostActions.newInstance()">Set up locally</Button>
      </Card>
    </div>
  </section>
</template>
