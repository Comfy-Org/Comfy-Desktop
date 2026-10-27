<script setup lang="ts">
import AppAgentStart from './AppAgentStart.vue'
import AppAgentChat from './AppAgentChat.vue'
import AgentPage from '../../pages/AgentPage.vue'
import { agent } from '../../agent'
import { flow } from '../../appFlow'

/** The Agent lens, making an app: the start screen, then the chat. A
 *  generation task from Home keeps the earlier agent thread. */
</script>

<template>
  <AgentPage v-if="!flow.messages.length && agent.messages.length" />
  <div v-else-if="!flow.messages.length" class="h-full overflow-y-auto"><AppAgentStart /></div>
  <AppAgentChat v-else />
</template>
