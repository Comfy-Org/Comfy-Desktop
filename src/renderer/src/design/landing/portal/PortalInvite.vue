<script setup lang="ts">
import { computed } from 'vue'
import { Monitor } from 'lucide-vue-next'
import Card from '../ui/Card.vue'
import Button from '../ui/Button.vue'
import SpaceMark from '../parts/space/SpaceMark.vue'
import ComfyCLogo from '../../../components/icons/ComfyCLogo.vue'
import { clientUser, currentSpace, STUDIO } from '../spaces'
import { proto } from '../useProto'

/** Step 1 of the member journey: the branded invite email. */
const space = computed(() => currentSpace.value)
const tools = computed(() => space.value.catalog.filter((c) => c.visible))
</script>

<template>
  <!-- A Comfy email: you're joining a Space on Comfy, not the brand's app. -->
  <div class="flex min-h-full items-start justify-center px-6 py-14">
    <div class="w-full max-w-xl">
      <p class="mb-3 text-ui text-subtle-foreground">Inbox · {{ clientUser.email }}</p>
      <Card class="overflow-hidden">
        <div class="border-b border-border-default px-6 py-4">
          <p class="text-ui">
            <span class="font-medium">Comfy</span>
            <span class="text-subtle-foreground"> &lt;spaces@comfy.org&gt;</span>
          </p>
          <p class="mt-0.5 text-ui font-semibold">
            You've been invited to the {{ space.name }} Space
          </p>
        </div>
        <div class="flex flex-col items-center px-10 py-10 text-center">
          <span
            class="inline-flex size-12 items-center justify-center rounded-card bg-secondary-background-hover"
            ><ComfyCLogo :size="26"
          /></span>
          <h2 class="mt-5 text-title font-semibold">
            You've been invited to the {{ space.name }} Space
          </h2>
          <p class="mt-2 text-ui text-muted-foreground">
            {{ STUDIO.name }} added you to a Space on Comfy with AI tools for your team.
          </p>
          <!-- The space, as an object you're joining -->
          <div
            class="mt-6 flex w-full max-w-sm items-center gap-3 rounded-card border border-border-default bg-secondary-background/50 px-4 py-3 text-left"
          >
            <SpaceMark :brand="space.brand" size="md" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-ui font-medium">{{ space.name }} Space</span>
              <span class="block truncate text-ui text-subtle-foreground"
                >{{ tools.length }} {{ tools.length === 1 ? 'tool' : 'tools' }} · by
                {{ STUDIO.name }}</span
              >
            </span>
          </div>
          <Button variant="primary" size="lg" class="mt-6" @click="proto.memberStage = 'signin'"
            >Join on Comfy</Button
          >
          <p class="mt-4 flex items-center gap-1.5 text-ui text-subtle-foreground">
            <Monitor :size="12" />Runs in your browser - nothing to install.
          </p>
        </div>
        <p class="border-t border-border-default px-6 py-3 text-ui text-subtle-foreground">
          You'll log in to Comfy, or create a free account. Sent on behalf of {{ STUDIO.name }}.
        </p>
      </Card>
    </div>
  </div>
</template>
