<script setup lang="ts">
import { computed } from 'vue'
import { Play, SquareArrowOutUpRight } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { envKind } from './env'
import { hostActions, proto, requireLogin } from '../../useProto'
import type { ProtoInstance } from '../../mock'

/** The one way into ComfyUI for an environment: running opens, stopped
 *  starts (paying the cold start). */
const {
  env,
  size = 'md',
  block = false
} = defineProps<{ env: ProtoInstance; size?: 'sm' | 'md' | 'lg'; block?: boolean }>()
const live = computed(() => env.state === 'running' || envKind(env) === 'managed')
function go(): void {
  if (env.kind === 'cloud' && !proto.signedIn) requireLogin()
  else hostActions.launch(env)
}
</script>

<template>
  <Button variant="primary" :size :block @click="go">
    <SquareArrowOutUpRight v-if="live" :size="13" />
    <Play v-else :size="13" />
    {{
      env.kind === 'cloud' && !proto.signedIn ? 'Log in' : live ? 'Open ComfyUI' : 'Start ComfyUI'
    }}
  </Button>
</template>
