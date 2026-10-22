<script setup lang="ts">
import { ref } from 'vue'
import { ArrowRight, Boxes, Check, KeyRound, Rocket } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import { cn } from '../../ui/cn'
import DevHero from '../../parts/env/DevHero.vue'
import { go, proto, toast } from '../../useProto'

/** Build for a first-time user: pick a path, then three steps to a first
 *  API call. No stats - there's nothing to measure yet. */
const done = ref<Record<string, boolean>>({})
const STEPS = [
  {
    key: 'key',
    icon: KeyRound,
    title: 'Create an API key',
    body: 'One key for models, workflows and deployments.',
    cta: 'Create key',
    run: () => ((done.value.key = true), toast('API key created - copied to clipboard'))
  },
  {
    key: 'model',
    icon: Boxes,
    title: 'Call a model',
    body: 'Try any image, video or audio model with one request.',
    cta: 'Browse models',
    run: () => ((done.value.model = true), go('router'))
  },
  {
    key: 'deploy',
    icon: Rocket,
    title: 'Deploy a workflow',
    body: 'Turn a workflow into your own endpoint. The agent can build one for you.',
    cta: 'Ask the agent',
    run: () => {
      proto.mode = 'agent'
      go('agent')
    }
  }
]
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <header class="pt-12 pb-8">
      <h1 class="text-title font-semibold tracking-[-0.01em]">Ship your first API</h1>
      <p class="mt-1 text-ui text-muted-foreground">Three steps, a few minutes.</p>
    </header>

    <div class="grid grid-cols-3 gap-3.5">
      <Card v-for="(s, i) in STEPS" :key="s.key" class="flex flex-col gap-3 p-5">
        <div class="flex items-center gap-2.5">
          <span
            :class="
              cn(
                'inline-flex size-6 items-center justify-center rounded-full border border-border-strong text-ui',
                done[s.key] && 'border-transparent bg-base-foreground text-inverted-foreground'
              )
            "
            ><Check v-if="done[s.key]" :size="12" /><template v-else>{{ i + 1 }}</template></span
          >
          <component :is="s.icon" :size="15" class="text-muted-foreground" />
        </div>
        <div class="flex-1">
          <p class="text-ui font-semibold">{{ s.title }}</p>
          <p class="mt-1 text-ui text-muted-foreground">{{ s.body }}</p>
        </div>
        <Button
          :variant="i === 0 && !done.key ? 'primary' : 'secondary'"
          class="self-start"
          @click="s.run()"
          >{{ s.cta }}<ArrowRight :size="13"
        /></Button>
      </Card>
    </div>

    <div class="mt-10"><DevHero /></div>
  </div>
</template>
