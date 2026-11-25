<script setup lang="ts">
import { computed } from 'vue'

import CreateScreen from './CreateScreen.vue'
import MarTemplateModal from '../templateModal/MarTemplateModal.vue'
import { createInTab } from './createScreen'
import { createLook } from './createLook'
import { lookComponent } from './looks'

const shown = computed(() => lookComponent(createLook.id) ?? CreateScreen)
</script>

<template>
  <component :is="shown" />
  <MarTemplateModal v-if="createInTab" />
</template>
